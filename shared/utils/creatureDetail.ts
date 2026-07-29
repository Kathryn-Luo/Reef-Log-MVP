import type { CreatureCategoryKey, CreatureStatusKey } from '../types/home'
import type { CreatureDetailDto, DeathCauseKey, UpdateCreatureStatusInput } from '../types/creature'
import { CREATURE_CATEGORY_LABELS, CREATURE_STATUS_LABELS, parseDateOnly } from './creatureCards'
import { DEATH_CAUSE_LABELS } from './creatureInventory'
import { isDateOnly } from './dateInput'

// 生物詳情 · 死亡記錄（screen-6）的顯示推算與欄位規則。
//
// 兩件事放在同一支：
//   1. 畫面上「算得出來的東西」——「魚 · 神仙」、「入缸日 2025 / 11 / 12」、
//      「在缸天數 189 天」。schema.prisma 明確不存這些衍生值。
//   2. 狀態 + 死亡 / 生病記錄的欄位規則。詳情頁（app/pages/creatures/[id].vue）與
//      PATCH /api/creatures/:id 共用 parseCreatureStatusInput：規則只寫一次，
//      前端擋掉的與後端擋掉的必然一致（與 shared/utils/tankForm.ts 同一個作法）。

const DAY = 24 * 60 * 60 * 1000

/** 症狀是列表第二行的一小段字，超過這個長度在手機上一定被截斷 */
const AILMENT_MAX_LENGTH = 40

/** 死亡備註是一段可以寫「之後加裝上蓋防跳網」的短文，給得比症狀寬 */
const DEATH_NOTE_MAX_LENGTH = 500

/** screen-6 的狀態三選一，順序與截圖由左至右一致 */
export const CREATURE_STATUS_OPTIONS: readonly { key: CreatureStatusKey, label: string }[] = [
  { key: 'ALIVE', label: CREATURE_STATUS_LABELS.ALIVE },
  { key: 'SICK', label: CREATURE_STATUS_LABELS.SICK },
  { key: 'DEAD', label: CREATURE_STATUS_LABELS.DEAD },
]

/**
 * 死因六選一。順序照 screen-6 的排列（生病 / 水質變化 / 被獵食 · 打架 /
 * 跳缸 / 餓死 / 原因不明），文字沿用 DEATH_CAUSE_LABELS——
 * 那一份取自 schema.prisma 的 enum 註解，庫存列表的「跳缸 · 05 / 20」用的也是它。
 */
export const DEATH_CAUSE_OPTIONS: readonly { key: DeathCauseKey, label: string }[] = [
  'DISEASE',
  'WATER_QUALITY',
  'PREDATION',
  'JUMPED',
  'STARVATION',
  'UNKNOWN',
].map(key => ({ key: key as DeathCauseKey, label: DEATH_CAUSE_LABELS[key as DeathCauseKey] }))

/** 「魚 · 神仙」；沒有細分類時只有「魚」，不留下孤零零的分隔點 */
export function formatTaxonomy(category: CreatureCategoryKey, subCategory: string | null): string {
  return [CREATURE_CATEGORY_LABELS[category], subCategory?.trim()]
    .filter(Boolean)
    .join(' · ')
}

/** 入缸日：2025-11-12 → 「2025 / 11 / 12」 */
export function formatFullDate(dateOnly: string): string {
  const date = parseDateOnly(dateOnly)
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${date.getUTCDate()}`.padStart(2, '0')

  return `${date.getUTCFullYear()} / ${month} / ${day}`
}

/**
 * 在缸天數。已死亡的算到 diedOn，否則算到今天——所以存活中的每天自動加一，
 * 這個數字不進資料庫（schema.prisma 檔頭的「設計原則」）。
 *
 * 兩端都取 UTC 的日期部分再相減，跨時區與日光節約都不會多算或少算一天。
 */
export function daysInTank(
  creature: Pick<CreatureDetailDto, 'addedOn' | 'diedOn'>,
  now: Date,
): number {
  const end = creature.diedOn
    ? parseDateOnly(creature.diedOn).getTime()
    : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())

  return Math.max(0, Math.round((end - parseDateOnly(creature.addedOn).getTime()) / DAY))
}

export type ParseCreatureStatusResult
  = | { ok: true, value: UpdateCreatureStatusInput }
    | { ok: false, message: string }

/** 這一隻自己的欄位，不由表單送出，但驗證日期先後時要拿來比 */
export interface CreatureStatusContext {
  /** 入缸日，`YYYY-MM-DD` */
  addedOn: string
}

const STATUS_KEYS = CREATURE_STATUS_OPTIONS.map(option => option.key)
const DEATH_CAUSE_KEYS = DEATH_CAUSE_OPTIONS.map(option => option.key)

function toTrimmedText(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

/** 留白（null / undefined / 空字串）視為沒填，而不是一個不合法的日期 */
function parseOptionalDate(
  raw: unknown,
  label: string,
): { ok: true, value: string | null } | { ok: false, message: string } {
  const text = toTrimmedText(raw)

  if (!text) {
    return { ok: true, value: null }
  }

  return isDateOnly(text)
    ? { ok: true, value: text }
    : { ok: false, message: `${label}請選擇一個實際存在的日期。` }
}

/**
 * 把表單狀態或請求 body 正規化成 UpdateCreatureStatusInput，
 * 不合規則時回傳可以直接顯示的訊息。
 *
 * 刻意不丟例外：詳情頁要把訊息畫在儲存按鈕旁，API 要把它轉成 400，兩邊都是「正常流程」。
 *
 * 「哪些欄位會被清掉」由狀態決定，而不是由使用者有沒有留白決定——
 * 改回存活卻留著死亡日，會讓庫存列表繼續把牠畫成死的。
 */
export function parseCreatureStatusInput(
  raw: unknown,
  context: CreatureStatusContext,
): ParseCreatureStatusResult {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const status = source.status as CreatureStatusKey

  if (!STATUS_KEYS.includes(status)) {
    return { ok: false, message: '狀態請選擇存活 / 生病 / 死亡。' }
  }

  // 存活：死亡與生病的欄位一律清空。發病日與症狀同樣清掉——牠現在是活的，
  // 留著會讓首頁的「⚠ 觀察中」與庫存列表的「觀察第 N 天」繼續掛在牠身上。
  // 也因此不必檢查那些日期的先後：反正都要被清掉。
  if (status === 'ALIVE') {
    return {
      ok: true,
      value: {
        status,
        observedSickOn: null,
        ailment: null,
        diedOn: null,
        causeOfDeath: null,
        deathNote: null,
      },
    }
  }

  const observedSickOn = parseOptionalDate(source.observedSickOn, '發病日')

  if (!observedSickOn.ok) {
    return observedSickOn
  }

  const ailment = toTrimmedText(source.ailment)

  if (ailment.length > AILMENT_MAX_LENGTH) {
    return { ok: false, message: `症狀請控制在 ${AILMENT_MAX_LENGTH} 字以內。` }
  }

  if (observedSickOn.value && observedSickOn.value < context.addedOn) {
    return { ok: false, message: '發病日不能早於入缸日。' }
  }

  // 生病：死亡記錄的三個欄位清掉，發病日（生病與死亡共用的同一欄）留著
  if (status === 'SICK') {
    return {
      ok: true,
      value: {
        status,
        observedSickOn: observedSickOn.value,
        ailment: ailment || null,
        diedOn: null,
        causeOfDeath: null,
        deathNote: null,
      },
    }
  }

  const diedOn = parseOptionalDate(source.diedOn, '死亡日')

  if (!diedOn.ok) {
    return diedOn
  }

  if (!diedOn.value) {
    return { ok: false, message: '標記為死亡時請填死亡日。' }
  }

  if (diedOn.value < context.addedOn) {
    return { ok: false, message: '死亡日不能早於入缸日。' }
  }

  if (observedSickOn.value && observedSickOn.value > diedOn.value) {
    return { ok: false, message: '發病日不能晚於死亡日。' }
  }

  // 死因是選填：畫面上六個選項都沒點也存得起來（schema 的 causeOfDeath 可為 null）
  const causeOfDeath = source.causeOfDeath == null || source.causeOfDeath === ''
    ? null
    : source.causeOfDeath as DeathCauseKey

  if (causeOfDeath !== null && !DEATH_CAUSE_KEYS.includes(causeOfDeath)) {
    return { ok: false, message: '死因請從清單中選擇。' }
  }

  const deathNote = toTrimmedText(source.deathNote)

  if (deathNote.length > DEATH_NOTE_MAX_LENGTH) {
    return { ok: false, message: `備註請控制在 ${DEATH_NOTE_MAX_LENGTH} 字以內。` }
  }

  return {
    ok: true,
    value: {
      status,
      observedSickOn: observedSickOn.value,
      ailment: ailment || null,
      diedOn: diedOn.value,
      causeOfDeath,
      deathNote: deathNote || null,
    },
  }
}
