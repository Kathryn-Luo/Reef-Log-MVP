// @vitest-environment node
// 純函式測試，不碰 Vue 元件、Nuxt composable 或 DOM；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getCreatureDetail, updateCreatureStatus } from '../../../server/utils/creatureDetail'

// 這個 job 連不到資料庫，Prisma Client 一律以假物件替身餵入
// （與 server/utils/creatureList.ts 的測試同一個作法）

const ROW = {
  id: 'f5',
  tankId: 'tank-1',
  name: '火焰仙',
  scientificName: 'Centropyge loriculus',
  category: 'FISH',
  subCategory: '神仙',
  status: 'DEAD',
  photoUrl: null,
  addedOn: new Date('2025-11-12T00:00:00.000Z'),
  price: { toString: () => '3200.00' },
  ailment: '白點',
  observedSickOn: new Date('2026-05-16T00:00:00.000Z'),
  diedOn: new Date('2026-05-20T00:00:00.000Z'),
  causeOfDeath: 'JUMPED',
  deathNote: '半夜跳出主缸，早上發現已乾。',
}

function fakeClient(found: unknown = null, updated: unknown = null) {
  const client = {
    creature: {
      findFirst: vi.fn().mockResolvedValue(found),
      update: vi.fn().mockResolvedValue(updated ?? found),
    },
  }

  return client as unknown as PrismaClient & typeof client
}

describe('getCreatureDetail', () => {
  // 網址被改成別人的 creatureId 時不該回傳資料——與 /api/tanks/:id/creatures 同一道檢查，
  // 只是這裡的歸屬要透過 tank 才看得到。
  it('只取當前使用者名下、未封存的缸底下的那一隻', async () => {
    const client = fakeClient(ROW)

    await getCreatureDetail(client, 'f5', 'user-1')

    expect(client.creature.findFirst).toHaveBeenCalledWith({
      where: { id: 'f5', tank: { userId: 'user-1', archivedAt: null } },
    })
  })

  // Then 顯示照片、俗名、學名，以及「<分類> · <細分類>」標籤
  // 詳情頁比庫存列表多要 subCategory 與 deathNote，@db.Date 一樣轉成 YYYY-MM-DD
  it('回傳詳情需要的欄位，日期轉成 YYYY-MM-DD', async () => {
    const creature = await getCreatureDetail(fakeClient(ROW), 'f5', 'user-1')

    expect(creature).toEqual({
      id: 'f5',
      name: '火焰仙',
      scientificName: 'Centropyge loriculus',
      category: 'FISH',
      subCategory: '神仙',
      status: 'DEAD',
      photoUrl: null,
      addedOn: '2025-11-12',
      ailment: '白點',
      observedSickOn: '2026-05-16',
      diedOn: '2026-05-20',
      causeOfDeath: 'JUMPED',
      deathNote: '半夜跳出主缸，早上發現已乾。',
    })
  })

  it('找不到（或不屬於這位使用者）時回傳 null', async () => {
    await expect(getCreatureDetail(fakeClient(null), 'f5', 'user-1')).resolves.toBeNull()
  })
})

describe('updateCreatureStatus', () => {
  // When 我選擇死因「跳缸」、填入死亡日並儲存 / Then 死因與死亡日被保存
  it('把狀態與死亡記錄寫進去，日期釘在 UTC 零時', async () => {
    const client = fakeClient(ROW)

    await updateCreatureStatus(client, 'f5', {
      status: 'DEAD',
      observedSickOn: '2026-05-16',
      ailment: '白點',
      diedOn: '2026-05-20',
      causeOfDeath: 'JUMPED',
      deathNote: '半夜跳出主缸，早上發現已乾。',
    })

    expect(client.creature.update).toHaveBeenCalledWith({
      where: { id: 'f5' },
      data: {
        status: 'DEAD',
        // @db.Date 釘在 UTC 零時，UTC+8 的使用者選 05/20 才不會被記成 05/19
        observedSickOn: new Date('2026-05-16T00:00:00.000Z'),
        ailment: '白點',
        diedOn: new Date('2026-05-20T00:00:00.000Z'),
        causeOfDeath: 'JUMPED',
        deathNote: '半夜跳出主缸，早上發現已乾。',
      },
    })
  })

  // Given 我把一隻已標記死亡的生物改回「存活」/ Then 死亡相關資料被清除
  it('改回存活時把死亡與生病的欄位一併寫成 null', async () => {
    const client = fakeClient(ROW, { ...ROW, status: 'ALIVE', observedSickOn: null, ailment: null, diedOn: null, causeOfDeath: null, deathNote: null })

    const creature = await updateCreatureStatus(client, 'f5', {
      status: 'ALIVE',
      observedSickOn: null,
      ailment: null,
      diedOn: null,
      causeOfDeath: null,
      deathNote: null,
    })

    expect(client.creature.update).toHaveBeenCalledWith({
      where: { id: 'f5' },
      data: {
        status: 'ALIVE',
        observedSickOn: null,
        ailment: null,
        diedOn: null,
        causeOfDeath: null,
        deathNote: null,
      },
    })

    expect(creature).toMatchObject({
      status: 'ALIVE',
      diedOn: null,
      causeOfDeath: null,
      deathNote: null,
    })
  })

  it('回傳更新後的詳情（與 GET 同一個形狀）', async () => {
    const client = fakeClient(ROW)

    const creature = await updateCreatureStatus(client, 'f5', {
      status: 'DEAD',
      observedSickOn: null,
      ailment: null,
      diedOn: '2026-05-20',
      causeOfDeath: 'JUMPED',
      deathNote: null,
    })

    expect(creature).toMatchObject({ id: 'f5', name: '火焰仙', subCategory: '神仙' })
  })
})
