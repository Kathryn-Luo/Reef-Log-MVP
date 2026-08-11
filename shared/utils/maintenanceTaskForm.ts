import type { CreateMaintenanceTaskInput, MaintenanceTaskInput } from '../types/maintenance'
import { isDateOnly } from './dateInput'

/**
 * 低於 Prisma Int 上限，也保證四位數年份的 startOn 加上週期後仍在 JavaScript Date 範圍內。
 * 這個技術上限約 26 萬年，遠高於任何實際保養週期。
 */
export const MAX_MAINTENANCE_INTERVAL_DAYS = 97_000_000

export const MAINTENANCE_INTERVAL_OPTIONS: readonly { value: number, label: string }[] = [
  { value: 1, label: '每天' },
  { value: 7, label: '每週' },
  { value: 30, label: '每月' },
  { value: 60, label: '每兩個月' },
]

const FORBIDDEN_TASK_KEYS = ['tankId', 'displayOrder', 'note', 'completions'] as const

export type ParseMaintenanceTaskResult
  = | { ok: true, value: MaintenanceTaskInput }
    | { ok: false, message: string }

export type ParseCreateMaintenanceTaskResult
  = | { ok: true, value: CreateMaintenanceTaskInput }
    | { ok: false, message: string }

function trimmedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function parseMaintenanceTaskInput(raw: unknown): ParseMaintenanceTaskResult {
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

  if (intervalDays > MAX_MAINTENANCE_INTERVAL_DAYS) {
    return { ok: false, message: '週期天數超過可支援範圍。' }
  }

  const startOn = trimmedText(source.startOn)

  if (startOn && !isDateOnly(startOn)) {
    return { ok: false, message: '起算日請選擇一個實際存在的日期。' }
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
  const parsed = parseMaintenanceTaskInput(raw)

  if (!parsed.ok) {
    return parsed
  }

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

  return { ok: true, value: { ...parsed.value, localCreatedOn } }
}
