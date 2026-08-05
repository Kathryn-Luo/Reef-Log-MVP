import type { WaterParameterKey, WaterReadingDto } from './home'

// 水質記錄（issue #121，畫面是 #11 的 screen-3）在 API 邊界上交換的資料形狀。
//
// 與 shared/types/tank.ts 同一個原則：不依賴 @prisma/client 的型別，
// 表單、驗證與 unit 測試因此都不必認識 Prisma。

/** 通過驗證之後的寫入內容。measuredAt 到這裡已經是一個時間點，時區換算在解析那一步完成 */
export interface CreateWaterLogInput {
  measuredAt: Date
  readings: WaterReadingDto[]
}

export interface WaterLogDto {
  id: string
  /** 量測的那個瞬間（ISO 8601，UTC）。不是建檔時間——見 schema.prisma 的 WaterLog.measuredAt */
  measuredAt: string
  /** 只包含這次真的有填的測項。未填的不建 WaterReading，所以這裡也不會有那一項 */
  readings: WaterReadingDto[]
}

export interface WaterLogPageData {
  /**
   * 每個測項最近一筆已存在的讀值，也就是畫面上每一欄右側的「上次 8.0」。
   *
   * 與 `waterLogs` 各自查：歷史有筆數上限，某個測項上一次量測落在截斷之外時，
   * 從歷史推導會讓那一格憑空消失（#11 要的是「最近一筆已存在的讀值」，不是
   * 「最近 N 筆裡的最後一筆」）。從未量測過的測項不在這個清單裡，畫面因此
   * 分得出「還沒量過」與「量過但這次沒填」。
   */
  previousReadings: WaterReadingDto[]
  /** 依量測時間新到舊，最多 WATER_LOG_HISTORY_LIMIT 筆 */
  waterLogs: WaterLogDto[]
}

/** 建立成功後回傳剛寫進去的那一筆，UI 不必為了拿到 id 與正規化後的時間再抓一次歷史 */
export interface CreateWaterLogResponse {
  waterLog: WaterLogDto
}

export interface WaterLogRequest {
  /** ISO 8601 timestamp with the recorder's UTC offset, e.g. 2026-07-08T21:30:00+08:00 */
  measuredAt: string
  readings: Partial<Record<WaterParameterKey, number | string | null>>
}
