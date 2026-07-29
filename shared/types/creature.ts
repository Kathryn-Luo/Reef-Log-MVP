// 生物庫存（Epic #1 screen-5）在 API 邊界上交換的資料形狀。
//
// 與 shared/types/home.ts 同一個原則：Prisma 的 Decimal 與 Date 一律在
// server/utils/creatureList.ts 轉成 number / 字串之後才送出。

import type { CreatureDto } from './home'

/** 對應 schema.prisma 的 enum DeathCause */
export type DeathCauseKey = 'DISEASE' | 'WATER_QUALITY' | 'PREDATION' | 'JUMPED' | 'STARVATION' | 'UNKNOWN'

/**
 * 庫存列表的一列。首頁卡片（CreatureDto）之外多帶三個欄位：
 * 學名（第二行前半）、發病日（「觀察第 N 天」）與死因（「跳缸」）。
 *
 * 用 extends 而不是另立一份形狀：兩邊指的是同一個 Creature，
 * 分開寫的話 countCreaturesByCategory 這類共用函式會開始要求兩種型別。
 */
export interface CreatureListItemDto extends CreatureDto {
  scientificName: string | null
  /** YYYY-MM-DD，沒有發病記錄則為 null */
  observedSickOn: string | null
  causeOfDeath: DeathCauseKey | null
}

export interface TankCreaturesData {
  creatures: CreatureListItemDto[]
}
