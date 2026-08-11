import type { Creature, PrismaClient } from '@prisma/client'
import type { CreatureDetailDto, CreatureProfileInput, UpdateCreatureStatusInput } from '#shared/types/creature'

// 生物詳情 · 死亡記錄（screen-6）的查詢與寫入。
//
// Prisma Client 由呼叫端傳入（server/utils/prisma.ts 的實例），與 creatureList.ts 同一個作法：
// 函式因此能在完全連不到資料庫的情況下用假 client 測試。

/** @db.Date 的欄位固定成 UTC 的 YYYY-MM-DD，在缸天數的推算才不會位移一天 */
function toDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null
}

/**
 * @db.Date 是「只有日期」的欄位，釘在 UTC 零時而不是本地零時，
 * 免得 UTC+8 的使用者選 05/20 卻被記成 05/19（與 server/utils/tankWrite.ts 同一個基準）。
 */
function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00.000Z`)
}

/**
 * 詳情頁要的是「這一隻」加上「牠在哪一缸」，所以兩支查詢都一起把缸名取回來。
 *
 * select 只點名 name：整個 Tank 拉回來會把開缸日、水量、代表色一併送進回應，
 * 而詳情頁一個都用不到（缸的其餘欄位由 GET /api/tanks 提供）。
 */
const WITH_TANK_NAME = { include: { tank: { select: { name: true } } } } as const

type CreatureWithTankName = Creature & { tank: { name: string } }

/** 詳情頁與基本資料表單共用的 API 形狀。 */
export function toCreatureDetail(creature: CreatureWithTankName): CreatureDetailDto {
  return {
    id: creature.id,
    tankId: creature.tankId,
    tankName: creature.tank.name,
    name: creature.name,
    scientificName: creature.scientificName,
    category: creature.category,
    subCategory: creature.subCategory,
    status: creature.status,
    photoUrl: creature.photoUrl,
    addedOn: toDateOnly(creature.addedOn)!,
    ailment: creature.ailment,
    observedSickOn: toDateOnly(creature.observedSickOn),
    diedOn: toDateOnly(creature.diedOn),
    causeOfDeath: creature.causeOfDeath,
    deathNote: creature.deathNote,
    price: creature.price === null ? null : Number(creature.price),
  }
}

/** 在已通過歸屬檢查的缸建立一隻生物；status 刻意交給 schema 的 ALIVE 預設值。 */
export async function createCreatureProfile(
  client: PrismaClient,
  tankId: string,
  input: CreatureProfileInput,
): Promise<CreatureDetailDto> {
  const creature = await client.creature.create({
    data: {
      tankId,
      name: input.name,
      scientificName: input.scientificName,
      category: input.category,
      subCategory: input.subCategory,
      addedOn: toDate(input.addedOn)!,
      price: input.price,
    },
    ...WITH_TANK_NAME,
  })

  return toCreatureDetail(creature)
}

/** 只更新基本資料；狀態與死亡／生病記錄不在 data 中。 */
export async function updateCreatureProfile(
  client: PrismaClient,
  creatureId: string,
  userId: string,
  input: CreatureProfileInput,
): Promise<CreatureDetailDto | null> {
  try {
    const creature = await client.creature.update({
      where: { id: creatureId, tank: { userId, archivedAt: null } },
      data: {
        name: input.name,
        scientificName: input.scientificName,
        category: input.category,
        subCategory: input.subCategory,
        addedOn: toDate(input.addedOn)!,
        price: input.price,
      },
      ...WITH_TANK_NAME,
    })

    return toCreatureDetail(creature)
  }
  catch (error) {
    if (isRecordNotFound(error)) {
      return null
    }

    throw error
  }
}

/**
 * 單一生物的詳情。
 *
 * 歸屬條件走 tank：生物掛在缸底下，缸才掛在使用者底下。網址被改成別人的
 * creatureId 時不該回傳資料——與 /api/tanks/:id/creatures 同一道檢查，
 * 也一併排除已封存的缸（那些缸不出現在任何清單裡，就不該從詳情頁繞進去）。
 */
export async function getCreatureDetail(
  client: PrismaClient,
  creatureId: string,
  userId: string,
): Promise<CreatureDetailDto | null> {
  const creature = await client.creature.findFirst({
    where: { id: creatureId, tank: { userId, archivedAt: null } },
    ...WITH_TANK_NAME,
  })

  return creature ? toCreatureDetail(creature) : null
}

/**
 * Prisma 在 `where` 一列都沒對上時丟的錯誤碼。
 *
 * 只認這一個碼：連線斷掉、約束衝突之類的失敗照常往外丟，
 * 一律折成「找不到」會把真正的故障顯示成一個看起來正常的 404。
 */
function isRecordNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025'
}

/**
 * 寫入狀態與死亡 / 生病記錄。查不到、或寫入當下歸屬已經不成立時回傳 null。
 *
 * 六個欄位一律整組寫入（含 null），不做「有填才更新」——
 * 「改回存活要把死亡日 / 死因 / 死亡備註清掉」正是靠這個。
 * 哪些欄位在哪個狀態下該是 null，由 shared/utils/creatureDetail.ts 的
 * parseCreatureStatusInput 決定，呼叫這裡之前必須先過那一關。
 *
 * 歸屬條件（`tank: { userId, archivedAt: null }`）也寫進 where，與 getCreatureDetail
 * 完全一致。呼叫端在這之前已經查過一次了，這裡不是重複檢查而是**讓歸屬在寫入語句
 * 本身成立**：查完到寫入之間有一段空隙，「把生物換缸」一旦成為功能，那段空隙就是
 * 一條真的可以被利用的路徑（讀的時候還是你的，寫的時候已經不是了）。
 */
export async function updateCreatureStatus(
  client: PrismaClient,
  creatureId: string,
  userId: string,
  input: UpdateCreatureStatusInput,
): Promise<CreatureDetailDto | null> {
  try {
    const creature = await client.creature.update({
      where: { id: creatureId, tank: { userId, archivedAt: null } },
      data: {
        status: input.status,
        observedSickOn: toDate(input.observedSickOn),
        ailment: input.ailment,
        diedOn: toDate(input.diedOn),
        causeOfDeath: input.causeOfDeath,
        deathNote: input.deathNote,
      },
      ...WITH_TANK_NAME,
    })

    return toCreatureDetail(creature)
  }
  catch (error) {
    if (isRecordNotFound(error)) {
      return null
    }

    throw error
  }
}

/**
 * 將生物移到另一個缸。來源歸屬放進 update 的 where，避免查到之後資料已被移走時仍寫入。
 *
 * 目標缸的歸屬與封存檢查由 authorization.ts 在呼叫前負責；這個函式只負責原子的來源寫入。
 */
export async function moveCreature(
  client: Pick<PrismaClient, 'creature'>,
  creatureId: string,
  userId: string,
  targetTankId: string,
): Promise<boolean> {
  try {
    await client.creature.update({
      where: { id: creatureId, tank: { userId, archivedAt: null } },
      data: { tankId: targetTankId },
    })

    return true
  }
  catch (error) {
    if (isRecordNotFound(error)) {
      return false
    }

    throw error
  }
}
