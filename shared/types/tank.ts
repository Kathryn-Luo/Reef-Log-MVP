import type { TankOption } from './home'

// 建立缸（issue #46）在 API 邊界上交換的資料形狀。
//
// 與 shared/types/home.ts 同一個原則：不依賴 @prisma/client 的型別，
// 表單、驗證與 unit 測試因此都不必認識 Prisma。

/**
 * POST /api/tanks 的內容。欄位對應 schema.prisma 的 Tank，
 * 缸名以外皆為選填——留白時一律送 null，不送空字串
 * （頁首的「主缸 · 4 尺」靠 falsy 判斷要不要補分隔點）。
 */
export interface CreateTankInput {
  name: string
  sizeSpec: string | null
  volumeLiters: number | null
  setupType: string | null
  colorHex: string | null
}

/** 建立成功後回傳的缸，形狀與缸切換選單共用 */
export interface CreateTankResponse {
  tank: TankOption
}
