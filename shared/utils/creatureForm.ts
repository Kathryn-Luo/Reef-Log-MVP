import type { CreatureCategoryKey } from '../types/home'
import type { CreatureProfileInput } from '../types/creature'
import { isDateOnly } from './dateInput'

/** Decimal(10, 2)：整數最多八位、小數最多兩位。 */
export const CREATURE_PRICE_MAX = 99_999_999.99

const PRICE_PATTERN = /^\d+(?:\.\d{1,2})?$/
const CATEGORY_KEYS: readonly CreatureCategoryKey[] = ['FISH', 'CORAL', 'OTHER']
const FORBIDDEN_PROFILE_KEYS = [
  'status',
  'observedSickOn',
  'ailment',
  'diedOn',
  'causeOfDeath',
  'deathNote',
] as const

export const CREATURE_CATEGORY_OPTIONS: readonly { key: CreatureCategoryKey, label: string }[] = [
  { key: 'FISH', label: '魚' },
  { key: 'CORAL', label: '珊瑚' },
  { key: 'OTHER', label: '其他' },
]

export type ParseCreatureProfileResult
  = | { ok: true, value: CreatureProfileInput }
    | { ok: false, message: string }

export interface CreatureProfileDateLimits {
  observedSickOn?: string | null
  diedOn?: string | null
}

function toTrimmedText(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

/** 以 `Date#getTimezoneOffset()` 的符號規則取得該時區的 YYYY-MM-DD。 */
export function dateOnlyAtTimeZoneOffset(now: Date, timeZoneOffsetMinutes: number): string {
  return new Date(now.getTime() - timeZoneOffsetMinutes * 60_000).toISOString().slice(0, 10)
}

function parsePrice(raw: unknown): { ok: true, value: number | null } | { ok: false, message: string } {
  if (raw === null || raw === undefined) {
    return { ok: true, value: null }
  }

  const text = typeof raw === 'number' ? String(raw) : toTrimmedText(raw)

  if (!text) {
    return { ok: true, value: null }
  }

  const value = Number(text)

  if (!PRICE_PATTERN.test(text) || !Number.isFinite(value) || value > CREATURE_PRICE_MAX) {
    return {
      ok: false,
      message: '購入價請填 0 到 99999999.99 之間的數字，且最多兩位小數。',
    }
  }

  return { ok: true, value }
}

/** 新增與編輯頁、兩支寫入 API 共用的基本資料規則。 */
export function parseCreatureProfileInput(
  raw: unknown,
  now: Date = new Date(),
  dateLimits: CreatureProfileDateLimits = {},
): ParseCreatureProfileResult {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>

  if (FORBIDDEN_PROFILE_KEYS.some(key => Object.hasOwn(source, key))) {
    return { ok: false, message: '基本資料表單不能修改狀態或死亡／生病記錄。' }
  }

  const name = toTrimmedText(source.name)

  if (!name) {
    return { ok: false, message: '請輸入俗名。' }
  }

  const category = source.category as CreatureCategoryKey

  if (!CATEGORY_KEYS.includes(category)) {
    return { ok: false, message: '請選擇分類。' }
  }

  const addedOn = toTrimmedText(source.addedOn)

  if (!addedOn) {
    return { ok: false, message: '請填入缸日。' }
  }

  if (!isDateOnly(addedOn)) {
    return { ok: false, message: '入缸日請選擇一個實際存在的日期。' }
  }

  const timeZoneOffsetMinutes = source.timeZoneOffsetMinutes

  if (
    typeof timeZoneOffsetMinutes !== 'number'
    || !Number.isInteger(timeZoneOffsetMinutes)
    || timeZoneOffsetMinutes < -840
    || timeZoneOffsetMinutes > 720
  ) {
    return { ok: false, message: '時區資訊不正確，請重新整理後再試。' }
  }

  if (addedOn > dateOnlyAtTimeZoneOffset(now, timeZoneOffsetMinutes)) {
    return { ok: false, message: '入缸日不能晚於今天。' }
  }

  if (dateLimits.observedSickOn && addedOn > dateLimits.observedSickOn) {
    return { ok: false, message: '入缸日不能晚於發病日。' }
  }

  if (dateLimits.diedOn && addedOn > dateLimits.diedOn) {
    return { ok: false, message: '入缸日不能晚於死亡日。' }
  }

  const price = parsePrice(source.price)

  if (!price.ok) {
    return price
  }

  return {
    ok: true,
    value: {
      name,
      scientificName: toTrimmedText(source.scientificName) || null,
      category,
      subCategory: toTrimmedText(source.subCategory) || null,
      addedOn,
      price: price.value,
    },
  }
}
