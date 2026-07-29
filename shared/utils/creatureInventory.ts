import type { CreatureCategoryKey, CreatureStatusKey } from '../types/home'
import type { CreatureListItemDto, DeathCauseKey } from '../types/creature'
import { CREATURE_STATUS_LABELS, monthsInTank, parseDateOnly } from './creatureCards'

// 生物庫存（screen-5）列表的顯示推算。
//
// schema.prisma 的設計原則：畫面上算得出來的東西都不進資料庫，所以
// 「入缸 8 月」「觀察第 3 天」「05 / 20」全部在這裡由日期欄位算出來。
//
// 與首頁（shared/utils/creatureCards.ts）刻意分成兩個檔：
// 同一批資料在兩個畫面上是兩種呈現——首頁把同名同狀態的合併成「公子小丑 ×2」的卡片，
// 庫存列表則是「一隻生物一列」（issue #13 的驗收條件：俗名含數量也照原樣顯示，
// 不把該筆視為多隻生物）。共用的只有月數推算與狀態標籤。

const DAY = 24 * 60 * 60 * 1000

/** 狀態 filter 的「全部」不是 CreatureStatus 的值，只存在於畫面上 */
export type CreatureStatusFilterKey = 'ALL' | CreatureStatusKey

export const CREATURE_STATUS_FILTERS: readonly { key: CreatureStatusFilterKey, label: string }[] = [
  { key: 'ALL', label: '全部' },
  { key: 'ALIVE', label: CREATURE_STATUS_LABELS.ALIVE },
  { key: 'SICK', label: CREATURE_STATUS_LABELS.SICK },
  { key: 'DEAD', label: CREATURE_STATUS_LABELS.DEAD },
]

/**
 * enum DeathCause ↔ 中文標籤。文字取自 schema.prisma 上每個 enum 值的註解，
 * 不另行改寫——screen-6 的死因選單之後用的是同一份對照表。
 */
export const DEATH_CAUSE_LABELS: Record<DeathCauseKey, string> = {
  DISEASE: '生病',
  WATER_QUALITY: '水質變化',
  PREDATION: '被獵食 / 打架',
  JUMPED: '跳缸',
  STARVATION: '餓死（不開口）',
  UNKNOWN: '原因不明',
}

export interface CreatureRowModel {
  id: string
  /** 第一行：俗名原樣顯示（名稱裡自帶的數量不做任何解讀） */
  title: string
  /** 第二行：存活「<學名> · 入缸 N 月」／生病「<症狀> · 觀察第 N 天」／死亡「<死因> · MM / DD」 */
  subtitle: string
  status: CreatureStatusKey
  statusLabel: string
  category: CreatureCategoryKey
  photoUrl: string | null
}

/**
 * 觀察天數：發病日為 3 天前 → 「觀察第 3 天」。
 * 兩邊都取 UTC 的日期部分再相減，跨時區與日光節約都不會多算或少算一天。
 */
export function daysObserved(observedSickOn: string, now: Date): number {
  const from = parseDateOnly(observedSickOn)
  const to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())

  return Math.max(0, Math.round((to - from.getTime()) / DAY))
}

/** 死亡列的日期：2026-05-20 → 「05 / 20」 */
export function formatMonthDay(dateOnly: string): string {
  const date = parseDateOnly(dateOnly)
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${date.getUTCDate()}`.padStart(2, '0')

  return `${month} / ${day}`
}

/** 沒填的欄位直接消失，不留下孤零零的分隔點 */
function join(parts: (string | null)[]): string {
  return parts.filter(Boolean).join(' · ')
}

function subtitleOf(creature: CreatureListItemDto, now: Date): string {
  if (creature.status === 'SICK') {
    // 症狀與發病日都沒填時仍要說明「牠正在被觀察」，不能只剩空白
    return join([
      creature.ailment,
      creature.observedSickOn ? `觀察第 ${daysObserved(creature.observedSickOn, now)} 天` : null,
    ]) || '觀察中'
  }

  if (creature.status === 'DEAD') {
    return join([
      creature.causeOfDeath ? DEATH_CAUSE_LABELS[creature.causeOfDeath] : null,
      creature.diedOn ? formatMonthDay(creature.diedOn) : null,
    ]) || CREATURE_STATUS_LABELS.DEAD
  }

  return join([creature.scientificName, `入缸 ${monthsInTank(creature, now)} 月`])
}

/** 一隻生物 = 一列，順序照傳入的順序（server 端已依 createdAt 排好） */
export function buildInventoryRows(creatures: CreatureListItemDto[], now: Date): CreatureRowModel[] {
  return creatures.map(creature => ({
    id: creature.id,
    title: creature.name,
    subtitle: subtitleOf(creature, now),
    status: creature.status,
    statusLabel: CREATURE_STATUS_LABELS[creature.status],
    category: creature.category,
    photoUrl: creature.photoUrl,
  }))
}

/** 分類 tab 與狀態 filter 各自獨立套用；狀態為「全部」時只看分類 */
export function filterCreatures(
  creatures: CreatureListItemDto[],
  category: CreatureCategoryKey,
  status: CreatureStatusFilterKey,
): CreatureListItemDto[] {
  return creatures.filter(creature =>
    creature.category === category && (status === 'ALL' || creature.status === status),
  )
}
