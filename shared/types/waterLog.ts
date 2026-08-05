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
  date: string
  time: string
  readings: Partial<Record<WaterParameterKey, number | string | null>>
}
