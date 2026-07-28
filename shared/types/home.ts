// 首頁（Epic #1 screen-1）在 API 邊界上交換的資料形狀。
//
// Prisma 的 Decimal 與 Date 一律在 server/utils/homeData.ts 轉成 number / 字串之後才送出，
// 所以這裡刻意不依賴 @prisma/client 的型別：app 端不必為了畫一張卡片而認識 Prisma，
// 型別也才能在連不到資料庫的 unit 測試裡自由組出夾具。

/** 對應 schema.prisma 的 enum WaterParameter */
export type WaterParameterKey = 'KH' | 'CA' | 'MG' | 'NO3' | 'PO4' | 'SALINITY'

/** 對應 schema.prisma 的 enum CreatureCategory */
export type CreatureCategoryKey = 'FISH' | 'CORAL' | 'OTHER'

/** 對應 schema.prisma 的 enum CreatureStatus */
export type CreatureStatusKey = 'ALIVE' | 'SICK' | 'DEAD'

/** 缸切換選單與頁首需要的欄位（Tank 的子集） */
export interface TankOption {
  id: string
  name: string
  sizeSpec: string | null
  volumeLiters: number | null
  setupType: string | null
  colorHex: string | null
}

export interface WaterReadingDto {
  parameter: WaterParameterKey
  value: number
}

export interface WaterTargetDto {
  parameter: WaterParameterKey
  minValue: number
  maxValue: number
}

/** 該缸 measuredAt 最新的那一筆 WaterLog，連同其讀數與該缸設定的正常區間 */
export interface WaterSummaryDto {
  /** ISO 8601 字串 */
  measuredAt: string
  readings: WaterReadingDto[]
  targets: WaterTargetDto[]
}

export interface CreatureDto {
  id: string
  name: string
  category: CreatureCategoryKey
  status: CreatureStatusKey
  photoUrl: string | null
  /** YYYY-MM-DD（Prisma 的 @db.Date） */
  addedOn: string
  ailment: string | null
  /** YYYY-MM-DD，尚未死亡則為 null */
  diedOn: string | null
}

export interface TankHomeData {
  /** 該缸尚無任何水質記錄時為 null */
  water: WaterSummaryDto | null
  creatures: CreatureDto[]
}
