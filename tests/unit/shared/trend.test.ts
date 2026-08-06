// @vitest-environment node
// 純函式測試，不碰 Vue 元件、Nuxt composable 或 DOM；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it } from 'vitest'
import type { TrendPointDto } from '../../../shared/types/trend'
import {
  DEFAULT_TREND_RANGE,
  INVALID_TREND_RANGE_MESSAGE,
  TREND_RANGES,
  parseTrendRange,
  summarizeTrendSeries,
  trendRangeStart,
} from '../../../shared/utils/trend'

// 趨勢圖（issue #126，畫面是 #12 的 screen-4）的三件純運算：
// 時間範圍怎麼解析、下界怎麼算、一組點怎麼收斂成畫面上那幾個數字。
//
// 這三支刻意不碰資料庫：畫面上每一個數字（大字的最新值、右側的「▼ 0.4（7 天）」、
// 下方的平均 / 最高 / 最低）都在這裡定案，邊界（空、單筆、全部同值）也就只是
// 一次直接呼叫，不必先組出一個假的 Prisma Client。

const NOW = new Date('2026-08-06T09:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

const point = (measuredAt: string, value: number): TrendPointDto => ({ measuredAt, value })

/** 由 NOW 往前 n 天的 ISO 字串，讀起來比一串日期字面量清楚 */
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString()

describe('parseTrendRange', () => {
  // Given range 是 7d / 30d / 90d / all
  it.each(['7d', '30d', '90d', 'all'] as const)('接受 %s', (raw) => {
    expect(parseTrendRange(raw)).toEqual({ ok: true, value: raw })
  })

  // 畫面上四顆按鈕的來源就是這一份，不是各自再寫一次
  it('TREND_RANGES 就是那四個合法值，順序與畫面上的按鈕一致', () => {
    expect(TREND_RANGES).toEqual(['7d', '30d', '90d', 'all'])
  })

  // Given range 沒有帶 / Then 視同 30d（畫面的預設值就是 30 天）
  it.each([
    ['undefined', undefined],
    ['null', null],
  ])('沒有帶（%s）時視同 30 天', (_label, raw) => {
    expect(parseTrendRange(raw)).toEqual({ ok: true, value: '30d' })
  })

  it('預設值是 30d 本身，而不是另外寫死的一個字串', () => {
    expect(DEFAULT_TREND_RANGE).toBe('30d')
    expect(TREND_RANGES).toContain(DEFAULT_TREND_RANGE)
  })

  // Given range 是無法辨識的值（例如 year、30、空字串）
  // Then 回 400「時間範圍不正確。」，不回半套資料，也不默默退回 30d
  //
  // 空字串（`?range=`）與大小寫不同的 `7D` 特別要擋：兩者都是「使用者打錯了」，
  // 悄悄當成 30 天的話，畫面會顯示一段他沒有要求的區間，而且看不出哪裡不對。
  it.each([
    ['year', 'year'],
    ['30（少了單位）', '30'],
    ['空字串', ''],
    ['只有空白', '   '],
    ['大寫的 7D', '7D'],
    ['帶空白的 7d', ' 7d'],
    ['數字 30', 30],
    ['ALL', 'ALL'],
    ['重複帶同一個參數（h3 會給陣列）', ['7d', '30d']],
    ['物件', { range: '7d' }],
    ['true', true],
  ])('拒絕 %s，訊息是「時間範圍不正確。」', (_label, raw) => {
    expect(parseTrendRange(raw)).toEqual({ ok: false, message: INVALID_TREND_RANGE_MESSAGE })
  })

  it('訊息是可以直接顯示的中文', () => {
    expect(INVALID_TREND_RANGE_MESSAGE).toBe('時間範圍不正確。')
  })
})

describe('trendRangeStart', () => {
  // Given range 是 7d / 30d / 90d
  // Then 只包含 measuredAt 落在「現在往前 N × 24 小時」之內的量測
  //
  // 用 N × 24 小時而不是日曆日：日曆日要有使用者的時區才算得準，而這支 GET 不帶時區
  // （issue #126 第 5 節第 3 點）。邊界因此落在一天中間，圖上看不太出來。
  it.each([
    ['7d', 7],
    ['30d', 30],
    ['90d', 90],
  ] as const)('%s 的下界是現在往前 %i × 24 小時', (range, days) => {
    expect(trendRangeStart(range, NOW)).toEqual(new Date(NOW.getTime() - days * DAY_MS))
  })

  // Given range 是 all / Then 包含該缸全部的量測，不設時間下界
  it('all 沒有下界', () => {
    expect(trendRangeStart('all', NOW)).toBeNull()
  })

  // now 由呼叫端傳入（與 parseWaterLogInput 同一個作法），改動它等於改到呼叫端手上的值
  it('不會就地改動傳進來的 now', () => {
    const now = new Date(NOW)

    trendRangeStart('7d', now)

    expect(now).toEqual(NOW)
  })
})

describe('summarizeTrendSeries', () => {
  // Given 某個測項在該區間內完全沒有讀值
  // Then latest / average / highest / lowest / change 一律為 null（不是 0、不是 NaN）
  //
  // 0 在這裡是個會騙人的值：PO₄ 真的可能量到 0，畫面分不出「這區間沒量」與「量到 0」。
  it('空序列的每一項都是 null，不是 0 也不是 NaN', () => {
    expect(summarizeTrendSeries([])).toEqual({
      latest: null,
      average: null,
      highest: null,
      lowest: null,
      change: null,
    })
  })

  // Given 某個測項在該區間內只有一筆讀值
  // Then latest / average / highest / lowest 都等於該值
  // And  change 為 null（一筆讀值算不出「變化」）
  it('只有一筆時四個統計都等於該值，change 為 null', () => {
    expect(summarizeTrendSeries([point(daysAgo(3), 7.8)])).toEqual({
      latest: 7.8,
      average: 7.8,
      highest: 7.8,
      lowest: 7.8,
      change: null,
    })
  })

  // 截圖右側的「▼ 0.4（7 天）」：最新值 7.8 與它前一筆 8.2 的差，括號內是兩筆實際相隔的天數
  it('多筆時 latest 取最後一筆，change 是它與前一筆的差', () => {
    const summary = summarizeTrendSeries([
      point(daysAgo(21), 8.0),
      point(daysAgo(7), 8.2),
      point(daysAgo(0), 7.8),
    ])

    expect(summary.latest).toBe(7.8)
    expect(summary.change?.days).toBe(7)
    // 浮點數的 8.2 − 7.8 差在小數末位，比對值本身而不是位元表示
    expect(summary.change?.delta).toBeCloseTo(-0.4, 10)
    // 負數＝下降，畫面據此畫成藍色 ▼。正負號是這個欄位唯一的方向資訊，不能丟
    expect(summary.change!.delta).toBeLessThan(0)
  })

  it('最新值比前一筆高時 delta 為正', () => {
    const summary = summarizeTrendSeries([point(daysAgo(7), 7.5), point(daysAgo(0), 8.5)])

    expect(summary.change).toEqual({ delta: 1, days: 7 })
  })

  it('最高 / 最低 / 平均看的是整段區間，不是只有頭尾', () => {
    const summary = summarizeTrendSeries([
      point(daysAgo(21), 7.5),
      point(daysAgo(14), 8.5),
      point(daysAgo(7), 8.0),
      point(daysAgo(0), 8.0),
    ])

    expect(summary.highest).toBe(8.5)
    expect(summary.lowest).toBe(7.5)
    expect(summary.average).toBe(8)
  })

  // 全部同值：變化量是 0 而不是 NaN。畫面會把它畫成「沒有變化」，
  // NaN 則會一路變成 UI 上的「NaN（7 天）」。
  it('全部同值時 delta 是 0，不是 NaN', () => {
    const summary = summarizeTrendSeries([
      point(daysAgo(14), 7.8),
      point(daysAgo(7), 7.8),
      point(daysAgo(0), 7.8),
    ])

    expect(summary.change?.delta).toBe(0)
    expect(Number.isNaN(summary.change?.delta)).toBe(false)
    expect(summary).toMatchObject({ latest: 7.8, average: 7.8, highest: 7.8, lowest: 7.8 })
  })

  // 平均值不四捨五入（issue #126 第 5 節第 4 點）：顯示位數是畫面的事，
  // 由 formatReadingValue() 決定。這裡先把它捨掉的話，畫面再也拿不回來。
  it('平均值不四捨五入，小數位也不失真', () => {
    const summary = summarizeTrendSeries([point(daysAgo(7), 0.021), point(daysAgo(0), 0.023)])

    expect(summary.average).toBeCloseTo(0.022, 12)
    expect(summary.average?.toFixed(3)).toBe('0.022')
  })

  it('平均值不取整數', () => {
    expect(summarizeTrendSeries([point(daysAgo(7), 1), point(daysAgo(0), 2)]).average).toBe(1.5)
  })

  // 天數四捨五入到整數：36 小時是 1.5 天，畫面寫「2 天」比「1 天」誠實
  it('change.days 四捨五入到整數', () => {
    const summary = summarizeTrendSeries([
      point(new Date(NOW.getTime() - 36 * 60 * 60 * 1000).toISOString(), 8.0),
      point(NOW.toISOString(), 7.8),
    ])

    expect(summary.change?.days).toBe(2)
  })

  // 同一分鐘內連存兩筆做得到（measuredAt 是分鐘精度），兩筆同時間的 days 是 0 而不是 NaN
  it('兩筆量測時間相同時 days 是 0', () => {
    const summary = summarizeTrendSeries([point(daysAgo(0), 8.0), point(daysAgo(0), 7.8)])

    expect(summary.change?.days).toBe(0)
    expect(summary.change?.delta).toBeCloseTo(-0.2, 10)
  })
})
