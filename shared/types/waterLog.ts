import type { WaterParameterKey, WaterReadingDto } from './home'

export interface CreateWaterLogInput {
  measuredAt: Date
  readings: WaterReadingDto[]
}

export interface WaterLogDto {
  id: string
  measuredAt: string
  readings: WaterReadingDto[]
}

export interface WaterLogPageData {
  previousReadings: WaterReadingDto[]
  waterLogs: WaterLogDto[]
}

export interface WaterLogRequest {
  /** ISO 8601 timestamp with the recorder's UTC offset, e.g. 2026-07-08T21:30:00+08:00 */
  measuredAt: string
  readings: Partial<Record<WaterParameterKey, number | string | null>>
}
