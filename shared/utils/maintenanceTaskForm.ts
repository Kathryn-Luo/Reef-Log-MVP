import type { MaintenanceTaskInput } from '../types/maintenance'
import { isDateOnly } from './dateInput'

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
