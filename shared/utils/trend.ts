import type { TrendChangeDto, TrendPointDto, TrendRangeKey } from '../types/trend'

// 趨勢圖（issue #126，畫面是 #12 的 screen-4）的純運算：時間範圍怎麼解析、
// 下界怎麼算、一組點怎麼收斂成畫面上那幾個數字。
//
// 為什麼是純函式、而且住在 shared：這三支不連資料庫就測得完，邊界（空、單筆、
// 全部同值）只是一次直接呼叫；#123 的畫面也用得到同一份範圍定義，不必再寫一次。

/** 四個合法的時間範圍，順序就是畫面下方那四顆按鈕的順序 */
export const TREND_RANGES: readonly TrendRangeKey[] = ['7d', '30d', '90d', 'all']

/** 未指定時採用的區間——畫面的預設值就是 30 天（screen-4 的「30 天」是點亮的那一顆） */
export const DEFAULT_TREND_RANGE: TrendRangeKey = '30d'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 各區間往前算幾天。
 *
 * 用 N × 24 小時而不是日曆日：日曆日要有使用者的時區才算得準，而這支 GET 目前不帶
 * 時區，要做的話得由前端傳當地日期，成本不對稱（issue #126 第 5 節第 3 點）。
 * 邊界因此會落在一天中間，圖上不太看得出來。
 */
const TREND_RANGE_DAYS: Record<Exclude<TrendRangeKey, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

/** 可以直接顯示給使用者的訊息，與其他 API 的 400 同一個作法（中文放 data.message） */
export const INVALID_TREND_RANGE_MESSAGE = '時間範圍不正確。'

/**
 * 查詢字串裡的 `range` → 區間，或一句可以直接顯示的錯誤。
 *
 * 沒有帶（undefined / null）視同 30d：畫面的預設值就是 30 天，第一次進站不必帶參數。
 *
 * 認不得的值一律回錯誤，**不默默退回 30d**：`?range=`（空字串）、`?range=30`、
 * `?range=7D` 都是「使用者或呼叫端打錯了」，悄悄換成 30 天的話，畫面會畫出一段
 * 沒人要求的區間，而且從結果上完全看不出哪裡不對。
 *
 * 收 `unknown` 而不是 `string`：`getQuery()` 對 `?range=7d&range=30d` 給的是陣列，
 * 型別上宣告成字串不會讓那個情況消失，只會讓它變成沒人檢查的那一條路。
 */
export function parseTrendRange(raw: unknown): { ok: true, value: TrendRangeKey } | { ok: false, message: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: DEFAULT_TREND_RANGE }
  }

  const matched = TREND_RANGES.find(range => range === raw)

  return matched
    ? { ok: true, value: matched }
    : { ok: false, message: INVALID_TREND_RANGE_MESSAGE }
}

/**
 * 區間的時間下界；`all` 沒有下界（回 null）。
 *
 * `now` 由呼叫端傳入（與 `parseWaterLogInput`、`daysInTank` 同一個作法）：
 * 測試因此不必假時鐘，也不會在 CI 跨過午夜那一刻偶發失敗。
 *
 * `all` 刻意不設筆數上限。與歷史列表的 `WATER_LOG_HISTORY_LIMIT` 不同：那裡截斷
 * 只影響「看得到幾列」，這裡截斷會**改變平均 / 最高 / 最低的答案**——一個算在半截
 * 資料上的「平均」比沒有更糟（issue #126 第 5 節第 2 點，列為已知缺口）。
 */
export function trendRangeStart(range: TrendRangeKey, now: Date): Date | null {
  return range === 'all' ? null : new Date(now.getTime() - TREND_RANGE_DAYS[range] * DAY_MS)
}

/** 一組序列收斂出來的統計。序列本身（points）不在裡面，由呼叫端拼上 */
export interface TrendSummary {
  latest: number | null
  average: number | null
  highest: number | null
  lowest: number | null
  change: TrendChangeDto | null
}

/**
 * 一組點 → 畫面上的那幾個數字。傳入的點必須**由舊到新**（查詢已經照 measuredAt asc 排）。
 *
 * 空序列的每一項都是 null，不是 0：PO₄ 真的可能量到 0，用 0 代表「這區間沒量」的話
 * 畫面分不出這兩件事。同理「只有一筆」的 change 是 null 而不是 0——0 會被畫成
 * 「持平」，但實際上是「還沒有第二筆可以比」。
 *
 * `change` 採「最新值 − 前一筆讀值，括號內是兩筆實際相隔的天數」（issue #126 第 5 節
 * 第 1 點）。另一種定義是固定 7 天窗口（拿最新值跟「7 天前最近的那筆」比），那會改變
 * `TrendChangeDto` 的形狀，review 時可以改，但要在這一支改完。
 *
 * 平均值不四捨五入：回原始 number，顯示位數由 `formatReadingValue()` 決定——
 * 顯示是畫面的事，在這裡先捨掉的話，畫面再也拿不回來。
 */
export function summarizeTrendSeries(points: TrendPointDto[]): TrendSummary {
  const latest = points.at(-1)
  const previous = points.at(-2)

  if (!latest) {
    return { latest: null, average: null, highest: null, lowest: null, change: null }
  }

  const values = points.map(point => point.value)

  return {
    latest: latest.value,
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    highest: Math.max(...values),
    lowest: Math.min(...values),
    change: previous
      ? {
          delta: latest.value - previous.value,
          days: Math.round(
            (new Date(latest.measuredAt).getTime() - new Date(previous.measuredAt).getTime()) / DAY_MS,
          ),
        }
      : null,
  }
}
