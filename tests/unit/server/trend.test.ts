// @vitest-environment node
// 純函式測試，Prisma Client 一律以假物件替身餵入；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { DEFAULT_WATER_TARGETS, WATER_PARAMETER_ORDER } from '../../../shared/utils/waterQuality'
import { getTrendPage } from '../../../server/utils/trendData'

// 趨勢圖的資料層（issue #126，畫面是 #12 的 screen-4）。
//
// 這個 job 連不到資料庫，所以 client 由呼叫端傳入（與 homeData.ts、waterLog.ts 同一個
// 作法）。替身照著 getTrendPage 實際下的 where 過濾記憶體中的列，區間之外的點拿不到
// 才是被查詢條件擋下來的，不是被夾具安排好的。

const NOW = new Date('2026-08-06T09:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

/** Prisma 的 Decimal 在型別上不是 number，夾具照它的樣子給 */
function decimal(value: string) {
  return { toString: () => value }
}

interface ReadingRow { parameter: string, value: { toString: () => string } }
interface LogRow { id: string, measuredAt: Date, readings: ReadingRow[] }
interface TargetRow { parameter: string, minValue: { toString: () => string }, maxValue: { toString: () => string } }

const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS)

/** 一筆量測；只填了 KH */
function khLog(id: string, days: number, value: string): LogRow {
  return { id, measuredAt: daysAgo(days), readings: [{ parameter: 'KH', value: decimal(value) }] }
}

function fakeClient(logs: LogRow[] = [], targets: TargetRow[] = []) {
  const client = {
    waterLog: {
      // 依 where 的下界過濾。一律回全部的話，「區間真的下在查詢上」就沒有東西可驗——
      // 在 JS 裡濾掉一樣會通過。
      findMany: vi.fn(({ where }: { where: { tankId: string, measuredAt?: { gte: Date } } }) => Promise.resolve(
        logs.filter(log => log.measuredAt >= (where.measuredAt?.gte ?? new Date(0))),
      )),
    },
    waterParameterTarget: {
      findMany: vi.fn(() => Promise.resolve(targets)),
    },
  }

  return client as unknown as PrismaClient & typeof client
}

const seriesFor = (page: Awaited<ReturnType<typeof getTrendPage>>, parameter: string) =>
  page.series.find(series => series.parameter === parameter)!

// Given 我是缸主，該缸在 30 天內有 5 筆量測
// When  我對 GET /api/tanks/<id>/trends?range=30d 發出請求
// Then  回傳六個測項各一組序列，每組的點依 measuredAt 由舊到新
// And   每組帶 latest / average / highest / lowest / change / target
describe('getTrendPage 的序列', () => {
  const logs = [
    { id: 'log-1', measuredAt: daysAgo(28), readings: [{ parameter: 'KH', value: decimal('8.0000') }, { parameter: 'CA', value: decimal('420.0000') }] },
    { id: 'log-2', measuredAt: daysAgo(21), readings: [{ parameter: 'KH', value: decimal('8.5000') }] },
    { id: 'log-3', measuredAt: daysAgo(14), readings: [{ parameter: 'KH', value: decimal('7.5000') }, { parameter: 'PO4', value: decimal('0.0400') }] },
    { id: 'log-4', measuredAt: daysAgo(7), readings: [{ parameter: 'KH', value: decimal('8.2000') }] },
    { id: 'log-5', measuredAt: daysAgo(0), readings: [{ parameter: 'KH', value: decimal('7.8000') }] },
  ]

  it('點依 measuredAt 由舊到新，Decimal 轉成 number', async () => {
    const page = await getTrendPage(fakeClient(logs), 'tank-1', '30d', NOW)

    expect(seriesFor(page, 'KH').points).toEqual([
      { measuredAt: daysAgo(28).toISOString(), value: 8 },
      { measuredAt: daysAgo(21).toISOString(), value: 8.5 },
      { measuredAt: daysAgo(14).toISOString(), value: 7.5 },
      { measuredAt: daysAgo(7).toISOString(), value: 8.2 },
      { measuredAt: daysAgo(0).toISOString(), value: 7.8 },
    ])
  })

  it('每一組都帶著 latest / average / highest / lowest / change / target', async () => {
    const page = await getTrendPage(fakeClient(logs), 'tank-1', '30d', NOW)
    const kh = seriesFor(page, 'KH')

    // 畫面上方的大字、下方的平均 / 最高 / 最低，以及右側的「▼ 0.4（7 天）」
    expect(kh.latest).toBe(7.8)
    // 五筆的和是 40，但相加的每一步都在浮點數上，比對值本身而不是位元表示
    expect(kh.average).toBeCloseTo(8, 10)
    expect(kh.highest).toBe(8.5)
    expect(kh.lowest).toBe(7.5)
    expect(kh.change?.days).toBe(7)
    expect(kh.change?.delta).toBeCloseTo(-0.4, 10)
    expect(kh.target).toEqual({ parameter: 'KH', ...DEFAULT_WATER_TARGETS.KH })
  })

  // Given 某個測項在該區間內完全沒有讀值
  // Then  該測項仍出現在回傳裡，points 為空陣列
  // And   latest / average / highest / lowest / change 一律為 null
  //
  // 與 previousReadings 刻意相反（那裡「不存在」代表「從未量測過」，是畫面要分辨的
  // 資訊）。這裡的缺席沒有意義，缺項只會逼 UI 為「這個 tab 不存在」另寫一種樣態。
  it('六個測項一定都在，順序是 WATER_PARAMETER_ORDER', async () => {
    const page = await getTrendPage(fakeClient(logs), 'tank-1', '30d', NOW)

    expect(page.series.map(series => series.parameter)).toEqual([...WATER_PARAMETER_ORDER])
  })

  it('沒有讀值的測項是空序列，統計一律 null', async () => {
    const page = await getTrendPage(fakeClient(logs), 'tank-1', '30d', NOW)

    expect(seriesFor(page, 'MG')).toMatchObject({
      parameter: 'MG',
      points: [],
      latest: null,
      average: null,
      highest: null,
      lowest: null,
      change: null,
    })
    // 空序列照樣有區間：畫面的背景色帶不必為了「這一項沒量過」另寫一種樣態
    expect(seriesFor(page, 'MG').target).toEqual({ parameter: 'MG', ...DEFAULT_WATER_TARGETS.MG })
  })

  it('只有一筆讀值的測項，change 為 null', async () => {
    const page = await getTrendPage(fakeClient(logs), 'tank-1', '30d', NOW)

    expect(seriesFor(page, 'CA')).toMatchObject({
      points: [{ measuredAt: daysAgo(28).toISOString(), value: 420 }],
      latest: 420,
      average: 420,
      highest: 420,
      lowest: 420,
      change: null,
    })
  })

  // 一個缸完全沒有量測過也走得完：六組空序列，而不是 null 或少掉幾項
  it('完全沒有量測時仍然回六組空序列', async () => {
    const page = await getTrendPage(fakeClient(), 'tank-1', '30d', NOW)

    expect(page.series).toHaveLength(WATER_PARAMETER_ORDER.length)
    expect(page.series.every(series => series.points.length === 0)).toBe(true)
  })

  // 實際採用的區間要跟著回去：未指定時是 30d，畫面照著把那顆按鈕點亮
  it.each(['7d', '30d', '90d', 'all'] as const)('回傳實際採用的區間（%s）', async (range) => {
    const page = await getTrendPage(fakeClient(logs), 'tank-1', range, NOW)

    expect(page.range).toBe(range)
  })
})

// Given range 是 7d / 30d / 90d
// Then 只包含 measuredAt 落在「現在往前 N × 24 小時」之內的量測
describe('getTrendPage 的查詢條件', () => {
  it.each([
    ['7d', 7],
    ['30d', 30],
    ['90d', 90],
  ] as const)('%s 把下界下在 where 上，不是撈回來再在 JS 裡濾', async (range, days) => {
    const client = fakeClient()

    await getTrendPage(client, 'tank-1', range, NOW)

    expect(client.waterLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tankId: 'tank-1', measuredAt: { gte: new Date(NOW.getTime() - days * DAY_MS) } },
    }))
  })

  // Given range 是 all / Then 包含該缸全部的量測，不設時間下界
  it('all 的 where 裡沒有 measuredAt', async () => {
    const client = fakeClient()

    await getTrendPage(client, 'tank-1', 'all', NOW)

    expect(client.waterLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tankId: 'tank-1' },
    }))
  })

  it('區間之外的量測不進序列', async () => {
    const client = fakeClient([khLog('log-old', 40, '9.0000'), khLog('log-new', 3, '7.8000')])
    const page = await getTrendPage(client, 'tank-1', '7d', NOW)

    expect(seriesFor(page, 'KH').points).toEqual([{ measuredAt: daysAgo(3).toISOString(), value: 7.8 }])
    // 落在區間外的那筆若被撈回來又在 JS 裡濾掉，平均是對的但查詢已經整包讀出來了
    expect(seriesFor(page, 'KH').average).toBe(7.8)
  })

  // createdAt 當次要排序鍵，理由同 #134：measuredAt 是分鐘精度，同一刻的兩筆若由
  // 資料庫決定先後，「最新一筆」（畫面上方的大字）就沒有保證。
  it('orderBy 是 [{ measuredAt: asc }, { createdAt: asc }]，並一次帶回 readings', async () => {
    const client = fakeClient()

    await getTrendPage(client, 'tank-1', '30d', NOW)

    expect(client.waterLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ measuredAt: 'asc' }, { createdAt: 'asc' }],
      include: { readings: true },
    }))
  })

  // 走 WaterLog 的 @@index([tankId, measuredAt])，一次查詢撈回區間內全部的 log；
  // WaterReading.parameter 上刻意沒有索引（schema.prisma 的註解），分組留在 JS
  it('六個測項共用同一次查詢，不是各查一次', async () => {
    const client = fakeClient()

    await getTrendPage(client, 'tank-1', '30d', NOW)

    expect(client.waterLog.findMany).toHaveBeenCalledTimes(1)
  })
})

// Given 該缸沒有替某個測項設定 WaterParameterTarget
// Then  該測項的 target 取自應用層預設區間（DEFAULT_WATER_TARGETS）
describe('getTrendPage 的正常區間', () => {
  const targets: TargetRow[] = [
    { parameter: 'KH', minValue: decimal('7.5000'), maxValue: decimal('8.5000') },
  ]

  it('有設定的測項取該缸的設定，Decimal 轉成 number', async () => {
    const page = await getTrendPage(fakeClient([], targets), 'tank-1', '30d', NOW)

    expect(seriesFor(page, 'KH').target).toEqual({ parameter: 'KH', minValue: 7.5, maxValue: 8.5 })
  })

  // server 端就 fallback 完，前端拿到的一定是可以直接畫的區間——
  // 兩邊各自 fallback 的話，遲早有一邊先漂走
  it('沒設定的測項取應用層預設區間，前端不必再 fallback', async () => {
    const page = await getTrendPage(fakeClient([], targets), 'tank-1', '30d', NOW)

    for (const parameter of WATER_PARAMETER_ORDER.filter(candidate => candidate !== 'KH')) {
      expect(seriesFor(page, parameter).target).toEqual({ parameter, ...DEFAULT_WATER_TARGETS[parameter] })
    }
  })

  it('區間查詢也帶著這個缸的條件', async () => {
    const client = fakeClient()

    await getTrendPage(client, 'tank-1', '30d', NOW)

    expect(client.waterParameterTarget.findMany).toHaveBeenCalledWith({ where: { tankId: 'tank-1' } })
  })
})
