import type { CreateMaintenanceTaskInput, MaintenanceTaskInput } from '../types/maintenance'
import { isDateOnly } from './dateInput'

const DAY_MS = 24 * 60 * 60 * 1000
const EARLIEST_MAINTENANCE_DATE = '0000-01-01'
const LATEST_MAINTENANCE_DATE = '9999-12-31'
const latestMaintenanceDay = Date.parse(`${LATEST_MAINTENANCE_DATE}T00:00:00.000Z`)

/** 從最早四位數年份到 9999-12-31 的絕對上限；實際可用值仍要依起算日縮小。 */
export const MAX_MAINTENANCE_INTERVAL_DAYS = Math.floor(
  (latestMaintenanceDay - Date.parse(`${EARLIEST_MAINTENANCE_DATE}T00:00:00.000Z`)) / DAY_MS,
)

/** 指定起算日後，仍能讓結果維持 `YYYY-MM-DD` 四位數年份的最大週期。 */
export function maxMaintenanceIntervalDays(startOn: string): number {
  if (!isDateOnly(startOn)) {
    return 0
  }

  return Math.max(0, Math.floor(
    (latestMaintenanceDay - Date.parse(`${startOn}T00:00:00.000Z`)) / DAY_MS,
  ))
}

export const MAINTENANCE_INTERVAL_OPTIONS: readonly { value: number, label: string }[] = [
  { value: 1, label: '每天' },
  { value: 7, label: '每週' },
  { value: 30, label: '每月' },
  { value: 60, label: '每兩個月' },
]

const FORBIDDEN_TASK_KEYS = ['tankId', 'displayOrder', 'createdOn', 'note', 'completions'] as const

export interface MaintenanceTaskDateContext {
  /** startOn 留白時的建立當地日。 */
  fallbackStartOn?: string
  /** 有完成紀錄時優先於 startOn，與 nextDueOn 的基準一致。 */
  lastCompletedOn?: string
}

export type ParseMaintenanceTaskResult
  = | { ok: true, value: MaintenanceTaskInput }
    | { ok: false, message: string }

export type ParseCreateMaintenanceTaskResult
  = | { ok: true, value: CreateMaintenanceTaskInput }
    | { ok: false, message: string }

function trimmedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function parseMaintenanceTaskInput(
  raw: unknown,
  context: MaintenanceTaskDateContext = {},
): ParseMaintenanceTaskResult {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>

  if (FORBIDDEN_TASK_KEYS.some(key => Object.hasOwn(source, key))) {
    return { ok: false, message: '保養任務表單不能修改所在缸、排序或完成履歷。' }
  }

  const name = trimmedText(source.name)

  if (!name) {
    return { ok: false, message: '請輸入任務名稱。' }
  }

  const intervalDays = typeof source.intervalDays === 'number'
    ? source.intervalDays
    : Number(trimmedText(source.intervalDays))

  if (!Number.isSafeInteger(intervalDays) || intervalDays <= 0) {
    return { ok: false, message: '週期天數請填正整數。' }
  }

  const startOn = trimmedText(source.startOn)

  if (startOn && !isDateOnly(startOn)) {
    return { ok: false, message: '起算日請選擇一個實際存在的日期。' }
  }

  const effectiveStartOn = context.lastCompletedOn || startOn || context.fallbackStartOn

  if (intervalDays > MAX_MAINTENANCE_INTERVAL_DAYS
    || (effectiveStartOn !== undefined
      && (!isDateOnly(effectiveStartOn) || intervalDays > maxMaintenanceIntervalDays(effectiveStartOn)))) {
    return { ok: false, message: '週期天數超過可支援範圍。' }
  }

  const isActive = source.isActive ?? true

  if (typeof isActive !== 'boolean') {
    return { ok: false, message: '啟用狀態不正確。' }
  }

  return {
    ok: true,
    value: {
      name,
      intervalDays,
      startOn: startOn || null,
      isActive,
    },
  }
}

/** 建立請求額外驗證瀏覽器當地日期；時區最多只會與 UTC 相差一個日曆日。 */
export function parseCreateMaintenanceTaskInput(
  raw: unknown,
  now: Date = new Date(),
): ParseCreateMaintenanceTaskResult {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const localCreatedOn = trimmedText(source.localCreatedOn)

  if (!isDateOnly(localCreatedOn)) {
    return { ok: false, message: '建立日期不正確。' }
  }

  const localDate = Date.parse(`${localCreatedOn}T00:00:00.000Z`)
  const serverDate = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const dayMs = 24 * 60 * 60 * 1000

  if (Math.abs(localDate - serverDate) > dayMs) {
    return { ok: false, message: '建立日期超出可接受範圍。' }
  }

  const parsed = parseMaintenanceTaskInput(raw, { fallbackStartOn: localCreatedOn })

  if (!parsed.ok) {
    return parsed
  }

  return { ok: true, value: { ...parsed.value, localCreatedOn } }
}
