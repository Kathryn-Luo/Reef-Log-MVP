import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getTankHome, listTankOptions } from '../../../server/utils/homeData'
import { WATER_TREND_POINTS } from '#shared/utils/waterQuality'

// 這個 job 連不到資料庫，Prisma Client 一律以假物件替身餵入
// （函式簽章刻意收 client 參數，與 server/utils/currentContext.ts 同一個作法）
function fakeClient(rows: {
  tanks?: unknown[]
  waterLogs?: unknown[]
  targets?: unknown[]
  creatures?: unknown[]
}) {
  const client = {
    tank: { findMany: vi.fn().mockResolvedValue(rows.tanks ?? []) },
    waterLog: { findMany: vi.fn().mockResolvedValue(rows.waterLogs ?? []) },
    waterParameterTarget: { findMany: vi.fn().mockResolvedValue(rows.targets ?? []) },
    creature: { findMany: vi.fn().mockResolvedValue(rows.creatures ?? []) },
  }

  return client as unknown as PrismaClient & typeof client
}

// Prisma 的 Decimal 在測試裡以「有 toString 的物件」模擬，確認轉換不是靠剛好是 number
function decimal(value: string) {
  return { toString: () => value }
}

/** 依 measuredAt 由新到舊的一批 WaterLog，與 Prisma 的 orderBy desc 回傳順序一致 */
function log(id: string, measuredAt: string, readings: { parameter: string, value: string }[]) {
  return {
    id,
    measuredAt: new Date(measuredAt),
    readings: readings.map(reading => ({ parameter: reading.parameter, value: decimal(reading.value) })),
  }
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
  // issue #10：儀表板的迷你趨勢線需要最近數筆讀數，所以這裡改成一次撈一個小窗口。
  // 最新一筆就是窗口的第一列，不必再多打一次 findFirst——兩者本來就是同一份資料。
  //
  // 查詢刻意只走 WaterLog 的 @@index([tankId, measuredAt])：schema.prisma 說明了
  // WaterReading 上不建 parameter 索引，趨勢是撈出區間後再於應用層依 parameter 分組。
  it('一次取最近數筆水質記錄（含讀數），最新的排在最前面', async () => {
    const client = fakeClient({})

    await getTankHome(client, 'tank-1')

    expect(client.waterLog.findMany).toHaveBeenCalledWith({
      where: { tankId: 'tank-1' },
      orderBy: { measuredAt: 'desc' },
      take: WATER_TREND_POINTS,
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
      waterLogs: [
        log('log-1', '2026-07-28T05:41:00.000Z', [
          { parameter: 'KH', value: '7.8000' },
          { parameter: 'PO4', value: '0.0400' },
        ]),
      ],
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
      // 只有一筆記錄時每個測項也只有一個點，趨勢線畫不出來但資料仍照實送出
      trends: [
        { parameter: 'KH', values: [7.8] },
        { parameter: 'PO4', values: [0.04] },
      ],
    })
  })

  // Then 每列顯示：……迷你趨勢線
  // 迷你趨勢線：取該缸該 parameter 最近數筆 WaterReading，依所屬 WaterLog.measuredAt 排序
  it('趨勢數列依 measuredAt 由舊到新排列，與查詢回傳的順序相反', async () => {
    const client = fakeClient({
      waterLogs: [
        log('log-new', '2026-07-28T05:00:00.000Z', [{ parameter: 'MG', value: '1180' }]),
        log('log-mid', '2026-07-21T05:00:00.000Z', [{ parameter: 'MG', value: '1260' }]),
        log('log-old', '2026-07-14T05:00:00.000Z', [{ parameter: 'MG', value: '1300' }]),
      ],
    })

    const home = await getTankHome(client, 'tank-1')

    // 折線由左（舊）往右（新）：Mg 一路下滑，正好解釋最新一筆的「偏低」
    expect(home.water?.trends).toEqual([{ parameter: 'MG', values: [1300, 1260, 1180] }])

    // 最新一筆仍是窗口的第一列
    expect(home.water?.measuredAt).toBe('2026-07-28T05:00:00.000Z')
    expect(home.water?.readings).toEqual([{ parameter: 'MG', value: 1180 }])
  })

  // screen-3 允許只填部分測項，未填的測項不會有 WaterReading 列
  it('某幾次沒量到的測項只把有量到的點串起來，完全沒量過的測項不出現', () => {
    const client = fakeClient({
      waterLogs: [
        log('log-new', '2026-07-28T05:00:00.000Z', [{ parameter: 'KH', value: '7.8' }]),
        log('log-old', '2026-07-21T05:00:00.000Z', [
          { parameter: 'KH', value: '7.6' },
          { parameter: 'NO3', value: '9' },
        ]),
      ],
    })

    return expect(getTankHome(client, 'tank-1').then(home => home.water?.trends)).resolves.toEqual([
      { parameter: 'KH', values: [7.6, 7.8] },
      { parameter: 'NO3', values: [9] },
    ])
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
