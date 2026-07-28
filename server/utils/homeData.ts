import type { PrismaClient } from '@prisma/client'
import type { CreatureDto, TankHomeData, TankOption, WaterSummaryDto } from '#shared/types/home'

// 首頁（screen-1）的資料查詢。
//
// Prisma Client 由呼叫端傳入（server/utils/prisma.ts 的實例），與 currentContext.ts 同一個作法：
// 函式因此能在完全連不到資料庫的情況下用假 client 測試。

/** Prisma 的 Decimal 直接序列化會變成物件，一律先轉 number 再送出前端 */
function toNumber(value: number | { toString: () => string }): number {
  return typeof value === 'number' ? value : Number(value.toString())
}

/** @db.Date 的欄位固定成 UTC 的 YYYY-MM-DD，月數推算才不會因時區位移一天 */
function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

/**
 * 缸切換選單的來源。排序與過濾條件依 schema.prisma 的 Tank.displayOrder 註解：
 * ORDER BY displayOrder ASC, createdAt ASC，且已封存（archivedAt 非 null）的缸不出現。
 * 清單中的第一個同時就是「預設缸」——schema 刻意沒有 isDefault 旗標。
 */
export async function listTankOptions(client: PrismaClient, userId: string): Promise<TankOption[]> {
  const tanks = await client.tank.findMany({
    where: { userId, archivedAt: null },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
  })

  return tanks.map(tank => ({
    id: tank.id,
    name: tank.name,
    sizeSpec: tank.sizeSpec,
    volumeLiters: tank.volumeLiters,
    setupType: tank.setupType,
    colorHex: tank.colorHex,
  }))
}

/**
 * 首頁單一缸的內容：最新一筆水質記錄（含讀數與該缸設定的正常區間）與全部生物。
 *
 * 「N 需注意」「· 4h」「存活 · N 月」「×2」都不在這裡算——它們是純顯示推算，
 * 由 shared/utils 的函式在前端完成，這裡只負責把原始資料轉成可序列化的形狀。
 */
export async function getTankHome(client: PrismaClient, tankId: string): Promise<TankHomeData> {
  const [latestLog, targets, creatures] = await Promise.all([
    client.waterLog.findFirst({
      where: { tankId },
      orderBy: { measuredAt: 'desc' },
      include: { readings: true },
    }),
    client.waterParameterTarget.findMany({ where: { tankId } }),
    client.creature.findMany({
      where: { tankId },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const water: WaterSummaryDto | null = latestLog
    ? {
        measuredAt: latestLog.measuredAt.toISOString(),
        readings: latestLog.readings.map(reading => ({
          parameter: reading.parameter,
          value: toNumber(reading.value),
        })),
        targets: targets.map(target => ({
          parameter: target.parameter,
          minValue: toNumber(target.minValue),
          maxValue: toNumber(target.maxValue),
        })),
      }
    : null

  const cards: CreatureDto[] = creatures.map(creature => ({
    id: creature.id,
    name: creature.name,
    category: creature.category,
    status: creature.status,
    photoUrl: creature.photoUrl,
    addedOn: toDateOnly(creature.addedOn),
    ailment: creature.ailment,
    diedOn: creature.diedOn ? toDateOnly(creature.diedOn) : null,
  }))

  return { water, creatures: cards }
}
