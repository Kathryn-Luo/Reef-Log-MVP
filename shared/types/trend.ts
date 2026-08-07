import type { WaterParameterKey, WaterTargetDto } from './home'

// 趨勢圖（issue #126，畫面是 #12 的 screen-4）在 API 邊界上交換的資料形狀。
//
// 與 shared/types/home.ts 同一個原則：不依賴 @prisma/client 的型別，
// 畫面與 unit 測試因此都不必認識 Prisma。
//
// 這一份是 #123（畫面那一半）要照著串的契約。圖上出現的每一個數字——上方大字的最新值、
// 右側的「▼ 0.4（7 天）」、下方的平均 / 最高 / 最低、背景色帶的 7–9——都在這裡有出處，
// 而且**只有一個**出處：畫面不再自己算一次跟後端不一樣的平均值。

export type TrendRangeKey = '7d' | '30d' | '90d' | 'all'

export interface TrendPointDto {
  /** ISO 8601（UTC） */
  measuredAt: string
  value: number
}

/** 期間變化量：最新一筆與它前一筆的差，以及兩筆之間實際相隔幾天 */
export interface TrendChangeDto {
  /** 最新 − 前一筆。負數＝下降（畫面畫成藍色 ▼） */
  delta: number
  /** 兩筆 measuredAt 相隔的天數，四捨五入到整數 */
  days: number
}

export interface TrendSeriesDto {
  parameter: WaterParameterKey
  /** 由舊到新 */
  points: TrendPointDto[]
  /** 這一段區間內完全沒有讀值時，以下五項一律為 null（不是 0、不是 NaN） */
  latest: number | null
  average: number | null
  highest: number | null
  lowest: number | null
  /** 只有一筆讀值時為 null——一筆算不出「變化」 */
  change: TrendChangeDto | null
  /** 未設定者已在 server 端套用預設區間，前端不必再 fallback */
  target: WaterTargetDto
}

export interface TrendPageData {
  /** 實際採用的區間（未指定時是 '30d'） */
  range: TrendRangeKey
  /**
   * 依 WATER_PARAMETER_ORDER，六項一定都在。
   *
   * 沒有讀值的那一項是「空序列」而不是「不存在」：畫面的六個 tab 是固定的，
   * 缺項會讓 UI 得為「這個 tab 不存在」另寫一種樣態。
   *
   * 這一點與 `previousReadings`（shared/types/waterLog.ts）刻意相反——那裡的
   * 「不存在」代表「從未量測過」，是畫面要分辨的資訊；這邊的缺席沒有意義。
   */
  series: TrendSeriesDto[]
}
