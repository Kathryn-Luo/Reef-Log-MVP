import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getTankHome, listTankOptions } from '../../../server/utils/homeData'

// 這個 job 連不到資料庫，Prisma Client 一律以假物件替身餵入
// （函式簽章刻意收 client 參數，與 server/utils/currentContext.ts 同一個作法）
function fakeClient(rows: {
  tanks?: unknown[]
  waterLog?: unknown
  targets?: unknown[]
  creatures?: unknown[]
}) {
  const client = {
    tank: { findMany: vi.fn().mockResolvedValue(rows.tanks ?? []) },
    waterLog: { findFirst: vi.fn().mockResolvedValue(rows.waterLog ?? null) },
    waterParameterTarget: { findMany: vi.fn().mockResolvedValue(rows.targets ?? []) },
    creature: { findMany: vi.fn().mockResolvedValue(rows.creatures ?? []) },
  }

  return client as unknown as PrismaClient & typeof client
}

// Prisma 的 Decimal 在測試裡以「有 toString 的物件」模擬，確認轉換不是靠剛好是 number
function decimal(value: string) {
  return { toString: () => value }
}

describe('listTankOptions', () => {
  // Given 我有兩個以上未封存的缸 / When 我點擊缸名旁的 ∨
  // Then 出現缸切換選單，依 displayOrder ASC, createdAt ASC 排序，
  //      且已封存（archivedAt 非 null）的缸不出現
  it('依 displayOrder、createdAt 排序，並排除已封存的缸', async () => {
    const client = fakeClient({ tanks: [] })

    await listTankOptions(client, 'user-1')

    expect(client.tank.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', archivedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    })
  })

  // Then 頁首顯示缸的代表色塊、缸名「主缸 · 4 尺」與副標「SPS MIXED · 420L」
  it('只送出頁首需要的欄位', async () => {
    const client = fakeClient({
      tanks: [{
        id: 'tank-1',
        userId: 'user-1',
        name: '主缸',
        sizeSpec: '4 尺',
        volumeLiters: 420,
        setupType: 'SPS MIXED',
        colorHex: '#2dd4bf',
        displayOrder: 0,
        archivedAt: null,
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
      }],
    })

    await expect(listTankOptions(client, 'user-1')).resolves.toEqual([{
      id: 'tank-1',
      name: '主缸',
      sizeSpec: '4 尺',
      volumeLiters: 420,
      setupType: 'SPS MIXED',
      colorHex: '#2dd4bf',
    }])
  })
})

describe('getTankHome', () => {
  it('取該缸 measuredAt 最新的一筆水質記錄與其讀數', async () => {
    const client = fakeClient({})

    await getTankHome(client, 'tank-1')

    expect(client.waterLog.findFirst).toHaveBeenCalledWith({
      where: { tankId: 'tank-1' },
      orderBy: { measuredAt: 'desc' },
      include: { readings: true },
    })
    expect(client.waterParameterTarget.findMany).toHaveBeenCalledWith({ where: { tankId: 'tank-1' } })
    expect(client.creature.findMany).toHaveBeenCalledWith({
      where: { tankId: 'tank-1' },
      orderBy: { createdAt: 'asc' },
    })
  })

  // Decimal 與 Date 都不能直接丟給前端：Decimal 序列化後會變成物件，
  // 日期則要固定成 UTC 的 YYYY-MM-DD，月數推算才不會因時區位移一天
  it('把 Decimal 轉成 number、DateTime 轉成 ISO 字串', async () => {
    const client = fakeClient({
      waterLog: {
        id: 'log-1',
        measuredAt: new Date('2026-07-28T05:41:00.000Z'),
        readings: [
          { parameter: 'KH', value: decimal('7.8000') },
          { parameter: 'PO4', value: decimal('0.0400') },
        ],
      },
      targets: [{ parameter: 'KH', minValue: decimal('7.0000'), maxValue: decimal('9.0000') }],
    })

    const home = await getTankHome(client, 'tank-1')

    expect(home.water).toEqual({
      measuredAt: '2026-07-28T05:41:00.000Z',
      readings: [
        { parameter: 'KH', value: 7.8 },
        { parameter: 'PO4', value: 0.04 },
      ],
      targets: [{ parameter: 'KH', minValue: 7, maxValue: 9 }],
    })
  })

  // Given 該缸尚無任何水質記錄
  it('該缸沒有水質記錄時 water 為 null', async () => {
    const home = await getTankHome(fakeClient({}), 'tank-1')

    expect(home.water).toBeNull()
    expect(home.creatures).toEqual([])
  })

  it('生物的日期欄位轉成 YYYY-MM-DD', async () => {
    const client = fakeClient({
      creatures: [{
        id: 'c9',
        tankId: 'tank-1',
        name: '六線龍',
        category: 'FISH',
        status: 'DEAD',
        photoUrl: null,
        addedOn: new Date('2025-10-10T00:00:00.000Z'),
        ailment: null,
        diedOn: new Date('2026-01-10T00:00:00.000Z'),
        price: decimal('900.00'),
      }],
    })

    const home = await getTankHome(client, 'tank-1')

    expect(home.creatures).toEqual([{
      id: 'c9',
      name: '六線龍',
      category: 'FISH',
      status: 'DEAD',
      photoUrl: null,
      addedOn: '2025-10-10',
      ailment: null,
      diedOn: '2026-01-10',
    }])
  })
})
