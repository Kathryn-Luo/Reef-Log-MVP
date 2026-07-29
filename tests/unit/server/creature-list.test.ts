import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getTankCreatures } from '../../../server/utils/creatureList'

// 這個 job 連不到資料庫，Prisma Client 一律以假物件替身餵入
// （與 server/utils/homeData.ts 的測試同一個作法）
function fakeClient(creatures: unknown[] = []) {
  const client = {
    creature: { findMany: vi.fn().mockResolvedValue(creatures) },
  }

  return client as unknown as PrismaClient & typeof client
}

const ROW = {
  id: 'f3',
  tankId: 'tank-1',
  name: '火焰仙',
  scientificName: 'Centropyge loriculus',
  category: 'FISH',
  subCategory: '神仙',
  status: 'DEAD',
  photoUrl: null,
  addedOn: new Date('2025-10-10T00:00:00.000Z'),
  ailment: '白點',
  observedSickOn: new Date('2026-05-16T00:00:00.000Z'),
  diedOn: new Date('2026-05-20T00:00:00.000Z'),
  causeOfDeath: 'JUMPED',
  deathNote: '半夜跳出主缸',
  price: { toString: () => '3200.00' },
}

describe('getTankCreatures', () => {
  // 分類 tab 的數量不受狀態 filter 影響，狀態 filter 也不改變分類數量——
  // 兩者都在前端套用，所以這裡一次取該缸的全部生物，不下 where 條件。
  it('取該缸全部的生物，依 createdAt 排序', async () => {
    const client = fakeClient()

    await getTankCreatures(client, 'tank-1')

    expect(client.creature.findMany).toHaveBeenCalledWith({
      where: { tankId: 'tank-1' },
      orderBy: { createdAt: 'asc' },
    })
  })

  // @db.Date 的欄位固定成 UTC 的 YYYY-MM-DD，月數與觀察天數的推算才不會位移一天
  it('日期欄位轉成 YYYY-MM-DD，並只送出列表需要的欄位', async () => {
    const creatures = await getTankCreatures(fakeClient([ROW]), 'tank-1')

    expect(creatures).toEqual([{
      id: 'f3',
      name: '火焰仙',
      scientificName: 'Centropyge loriculus',
      category: 'FISH',
      status: 'DEAD',
      photoUrl: null,
      addedOn: '2025-10-10',
      ailment: '白點',
      observedSickOn: '2026-05-16',
      diedOn: '2026-05-20',
      causeOfDeath: 'JUMPED',
    }])
  })

  it('未填的日期與死因維持 null', async () => {
    const alive = {
      ...ROW,
      id: 'f1',
      name: '藍倒吊',
      status: 'ALIVE',
      scientificName: null,
      ailment: null,
      observedSickOn: null,
      diedOn: null,
      causeOfDeath: null,
    }

    const creatures = await getTankCreatures(fakeClient([alive]), 'tank-1')

    expect(creatures[0]).toMatchObject({
      scientificName: null,
      ailment: null,
      observedSickOn: null,
      diedOn: null,
      causeOfDeath: null,
    })
  })

  it('該缸沒有生物時回傳空陣列', async () => {
    await expect(getTankCreatures(fakeClient(), 'tank-1')).resolves.toEqual([])
  })
})
