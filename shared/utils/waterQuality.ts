import type { WaterParameterKey, WaterReadingDto, WaterTargetDto } from '../types/home'

/** screen-1 水質摘要列的欄位順序，同時也是 screen-2 / 3 / 4 的排列順序 */
export const WATER_PARAMETER_ORDER: readonly WaterParameterKey[] = [
  'KH',
  'CA',
  'MG',
  'NO3',
  'PO4',
  'SALINITY',
]

/** 畫面上的標籤。單位（dKH / ppm / SG）是測項固有性質，屬應用層常數，不進資料庫 */
export const WATER_PARAMETER_LABELS: Record<WaterParameterKey, string> = {
  KH: 'KH',
  CA: 'Ca',
  MG: 'Mg',
  NO3: 'NO₃',
  PO4: 'PO₄',
  SALINITY: '鹽',
}

/**
 * 未設定 WaterParameterTarget 的測項套用的預設區間。
 * 依 schema.prisma 的 WaterParameterTarget 註解：「沒有設定的測項由應用層套用預設區間」，
 * 刻意不寫進資料庫。KH / Ca / Mg 三項取自 screen-2 右側標示的 7–9、380–450、1250–1350。
 */
export const DEFAULT_WATER_TARGETS: Record<WaterParameterKey, { minValue: number, maxValue: number }> = {
  KH: { minValue: 7, maxValue: 9 },
  CA: { minValue: 380, maxValue: 450 },
  MG: { minValue: 1250, maxValue: 1350 },
  NO3: { minValue: 1, maxValue: 10 },
  PO4: { minValue: 0.01, maxValue: 0.1 },
  SALINITY: { minValue: 1.024, maxValue: 1.027 },
}

/** 各測項的慣用顯示精度，對齊 screen-1 的 7.8 / 412 / 1180 / 12 / .04 / 1.026 */
const DISPLAY_DECIMALS: Record<WaterParameterKey, number> = {
  KH: 1,
  CA: 0,
  MG: 0,
  NO3: 0,
  PO4: 2,
  SALINITY: 3,
}

export type ReadingStatus = 'normal' | 'low' | 'high'

export interface WaterSummaryItem {
  parameter: WaterParameterKey
  label: string
  value: number
  display: string
  status: ReadingStatus
}

export function resolveWaterTarget(
  parameter: WaterParameterKey,
  targets: WaterTargetDto[],
): { minValue: number, maxValue: number } {
  const configured = targets.find(target => target.parameter === parameter)

  if (!configured) {
    return DEFAULT_WATER_TARGETS[parameter]
  }

  return { minValue: configured.minValue, maxValue: configured.maxValue }
}

/** 區間為閉區間：等於上下限仍算正常 */
export function readingStatus(value: number, target: { minValue: number, maxValue: number }): ReadingStatus {
  if (value < target.minValue) {
    return 'low'
  }

  if (value > target.maxValue) {
    return 'high'
  }

  return 'normal'
}

export function formatReadingValue(parameter: WaterParameterKey, value: number): string {
  const text = value.toFixed(DISPLAY_DECIMALS[parameter])

  // screen-1 的 PO₄ 顯示為「.04」：省略小數點前的 0，六個數字才在窄螢幕上排得下
  return text.startsWith('0.') ? text.slice(1) : text
}

/**
 * 把一筆水質記錄的讀數整理成摘要列，並數出「N 需注意」。
 * 未量測的測項不會有 WaterReading 列（見 schema.prisma 的 @@unique 註解），這裡也就不補位。
 */
export function summarizeWaterReadings(
  readings: WaterReadingDto[],
  targets: WaterTargetDto[],
): { items: WaterSummaryItem[], attentionCount: number } {
  const items = WATER_PARAMETER_ORDER.flatMap<WaterSummaryItem>((parameter) => {
    const reading = readings.find(candidate => candidate.parameter === parameter)

    if (!reading) {
      return []
    }

    return [{
      parameter,
      label: WATER_PARAMETER_LABELS[parameter],
      value: reading.value,
      display: formatReadingValue(parameter, reading.value),
      status: readingStatus(reading.value, resolveWaterTarget(parameter, targets)),
    }]
  })

  return {
    items,
    attentionCount: items.filter(item => item.status !== 'normal').length,
  }
}
