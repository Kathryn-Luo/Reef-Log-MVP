import type {
  WaterParameterKey,
  WaterReadingDto,
  WaterSummaryDto,
  WaterTargetDto,
} from '../types/home'

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
 * screen-2 儀表板用的標籤。一列一項、空間夠，鹽度不再縮寫成摘要列的「鹽」。
 * 其餘五項兩處相同，但仍各自列全——之後任一邊要調整才不會牽動另一邊。
 */
export const WATER_PARAMETER_FULL_LABELS: Record<WaterParameterKey, string> = {
  KH: 'KH',
  CA: 'Ca',
  MG: 'Mg',
  NO3: 'NO₃',
  PO4: 'PO₄',
  SALINITY: '鹽度',
}

/**
 * 單位。依 schema.prisma 的 WaterParameter 註解，單位是測項本身固有的性質，
 * 屬應用層常數，不重複存進資料庫。
 */
export const WATER_PARAMETER_UNITS: Record<WaterParameterKey, string> = {
  KH: 'dKH',
  CA: 'ppm',
  MG: 'ppm',
  NO3: 'ppm',
  PO4: 'ppm',
  SALINITY: 'SG',
}

/**
 * 迷你趨勢線一次取幾筆水質記錄。
 * 夠看出走勢又不會讓首頁的 payload 變胖——單缸一年約 50–100 筆 log，
 * 這個窗口走 WaterLog 的 @@index([tankId, measuredAt])，一次查詢就撈得完。
 */
export const WATER_TREND_POINTS = 8

/** 該測項這次沒量到時，儀表板那一格顯示的字 */
export const MISSING_READING_TEXT = '—'

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

// ─────────────────────────────────────────────
// screen-2 數據儀表板
// ─────────────────────────────────────────────

/** 狀態文字與方向箭頭。正常沒有箭頭——只有偏離區間才需要指出方向 */
const STATUS_LABELS: Record<ReadingStatus, string> = {
  normal: '正常',
  low: '偏低',
  high: '偏高',
}

const STATUS_ICONS: Record<ReadingStatus, string | null> = {
  normal: null,
  low: '▼',
  high: '▲',
}

export interface WaterDashboardRow {
  parameter: WaterParameterKey
  label: string
  unit: string
  /** 這次沒量到時為 null */
  value: number | null
  /** 沒量到時是 MISSING_READING_TEXT */
  display: string
  /** 沒量到就沒有狀態可言——不是正常，也不計入「N 需注意」 */
  status: ReadingStatus | null
  statusLabel: string | null
  statusIcon: string | null
  /** 正常區間文字，例：1250–1350。與有沒有量到無關 */
  rangeText: string
  /** 最近數筆讀數，由舊到新。少於兩筆就畫不出折線 */
  trend: number[]
}

/**
 * 區間上下限的顯示格式。
 *
 * 整數的上下限不補小數位（截圖的 7–9、380–450、2–10），帶小數的才沿用該測項的
 * 顯示精度（.02–.10、1.024–1.027）。區間通常設成整數，一律補到測項精度會變成
 * 「7.0–9.0」，跟截圖不符也比較難讀。
 */
function formatBound(parameter: WaterParameterKey, value: number): string {
  return Number.isInteger(value) ? String(value) : formatReadingValue(parameter, value)
}

/** 連接號用 EN DASH（–），與截圖一致 */
export function formatTargetRange(
  parameter: WaterParameterKey,
  target: { minValue: number, maxValue: number },
): string {
  return `${formatBound(parameter, target.minValue)}–${formatBound(parameter, target.maxValue)}`
}

/**
 * 儀表板的六列。
 *
 * 與摘要列（summarizeWaterReadings）最大的差別是「缺項的處理」：
 * 摘要列只排出量到的測項，儀表板六列固定到齊，沒量到的那列顯示「—」。
 * 同一次量測允許只填部分測項（screen-3），而儀表板要讓人看出「哪一項這次沒測」。
 */
export function buildWaterDashboardRows(water: WaterSummaryDto | null): WaterDashboardRow[] {
  const readings = water?.readings ?? []
  const targets = water?.targets ?? []
  const trends = water?.trends ?? []

  return WATER_PARAMETER_ORDER.map((parameter) => {
    const reading = readings.find(candidate => candidate.parameter === parameter)
    const target = resolveWaterTarget(parameter, targets)
    const status = reading ? readingStatus(reading.value, target) : null

    return {
      parameter,
      label: WATER_PARAMETER_FULL_LABELS[parameter],
      unit: WATER_PARAMETER_UNITS[parameter],
      value: reading?.value ?? null,
      display: reading ? formatReadingValue(parameter, reading.value) : MISSING_READING_TEXT,
      status,
      statusLabel: status ? STATUS_LABELS[status] : null,
      statusIcon: status ? STATUS_ICONS[status] : null,
      rangeText: formatTargetRange(parameter, target),
      trend: trends.find(series => series.parameter === parameter)?.values ?? [],
    }
  })
}
