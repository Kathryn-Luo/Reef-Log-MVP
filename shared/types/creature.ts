// 生物庫存（Epic #1 screen-5）在 API 邊界上交換的資料形狀。
//
// 與 shared/types/home.ts 同一個原則：Prisma 的 Decimal 與 Date 一律在
// server/utils/creatureList.ts 轉成 number / 字串之後才送出。

import type { CreatureCategoryKey, CreatureDto, CreatureStatusKey } from './home'

/** 新增與編輯生物基本資料共用的請求內容。 */
export interface CreatureProfileInput {
  name: string
  scientificName: string | null
  category: CreatureCategoryKey
  subCategory: string | null
  /** YYYY-MM-DD（Prisma 的 @db.Date） */
  addedOn: string
  price: number | null
}

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

/**
 * 生物詳情（screen-6）的一隻。庫存列表（CreatureListItemDto）之外多帶兩個欄位：
 * 細分類（「魚 · 神仙」的後半段）與死亡記錄區塊裡的備註。
 *
 * 同樣用 extends：三張畫面指的是同一個 Creature，形狀分家的話
 * daysInTank / buildInventoryRows 這類共用函式會開始要求各自的型別。
 *
 * price 由新增／編輯基本資料表單使用；詳情頁目前不呈現，但共用的 GET 回應仍帶回，
 * 編輯頁才能顯示原值。
 */
export interface CreatureDetailDto extends CreatureListItemDto {
  subCategory: string | null
  /** 死亡記錄區塊專用的備註，不是通用飼養備註（見 schema.prisma 的註解） */
  deathNote: string | null
  price: number | null

  /**
   * 所在缸（issue #120）。庫存列表與首頁卡片都是「從某一缸點進去的」，所以那兩張畫面
   * 不必問這件事；詳情頁是唯一手上只有 creatureId 的入口，而「移動到其他缸」要先畫得出
   * 「現在在哪」，也要能把目前這一缸從目標清單裡濾掉。
   *
   * 兩個欄位都在 Creature 那一列的射程內（tankId 是自己的欄位，缸名是關聯缸的 name），
   * 不動 schema，也不是新的授權面——查得到這一隻就查得到它的缸。
   */
  tankId: string
  tankName: string
}

/**
 * PATCH /api/creatures/:id 的內容——詳情頁「狀態 + 死亡 / 生病記錄」那一段。
 *
 * 其餘欄位（俗名、學名、照片、入缸日…）不在這裡：那是「編輯生物」表單的事，
 * 由另一支 needs-design 的 issue 負責。
 *
 * 日期一律是 `YYYY-MM-DD` 字串：它會經過 JSON 來回，而且日期選擇器交出來的
 * 就是這個格式，換算成時間點是寫入端的事（server/utils/creatureDetail.ts）。
 */
export interface UpdateCreatureStatusInput {
  status: CreatureStatusKey
  observedSickOn: string | null
  ailment: string | null
  diedOn: string | null
  causeOfDeath: DeathCauseKey | null
  deathNote: string | null
}

/** GET / PATCH /api/creatures/:id 的回應 */
export interface CreatureDetailResponse {
  creature: CreatureDetailDto
}

/** POST /api/tanks/:id/creatures 與 PATCH /api/creatures/:id/profile 的回應。 */
export type CreatureProfileResponse = CreatureDetailResponse

/** PATCH /api/creatures/:id/move 的回應，只回傳畫面重新取資料所需的識別資訊。 */
export interface MoveCreatureResponse {
  creatureId: string
  tankId: string
}
