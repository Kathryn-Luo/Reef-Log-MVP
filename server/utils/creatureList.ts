import type { PrismaClient } from '@prisma/client'
import type { CreatureListItemDto } from '#shared/types/creature'

// 生物庫存（screen-5）的資料查詢。
//
// Prisma Client 由呼叫端傳入（server/utils/prisma.ts 的實例），與 homeData.ts 同一個作法：
// 函式因此能在完全連不到資料庫的情況下用假 client 測試。

/** @db.Date 的欄位固定成 UTC 的 YYYY-MM-DD，月數與觀察天數的推算才不會位移一天 */
function toDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null
}

/**
 * 該缸的全部生物。
 *
 * 刻意不下 where 的 status / category 條件：分類 tab 上的數量是「不受狀態 filter
 * 影響的分類總數」，狀態 filter 也不改變分類數量——兩個維度都要看得到完整的母體，
 * 所以一次取回、由前端（shared/utils/creatureInventory.ts）套用篩選。
 * 單缸的生物是幾十筆的量級，不需要為此往返兩次。
 */
export async function getTankCreatures(
  client: PrismaClient,
  tankId: string,
): Promise<CreatureListItemDto[]> {
  const creatures = await client.creature.findMany({
    where: { tankId },
    orderBy: { createdAt: 'asc' },
  })

  return creatures.map(creature => ({
    id: creature.id,
    name: creature.name,
    scientificName: creature.scientificName,
    category: creature.category,
    status: creature.status,
    photoUrl: creature.photoUrl,
    addedOn: toDateOnly(creature.addedOn)!,
    ailment: creature.ailment,
    observedSickOn: toDateOnly(creature.observedSickOn),
    diedOn: toDateOnly(creature.diedOn),
    causeOfDeath: creature.causeOfDeath,
  }))
}
