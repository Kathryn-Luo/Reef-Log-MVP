import type { ImageResizeOptions, ImageResizeResult } from './avatarImage'
import { resizeImage } from './avatarImage'

// 生物照片送出前的等比縮圖（issue #154）。
//
// 引擎與頭像共用（`avatarImage.ts` 的 `resizeImage`），這一支只放生物照片的設定。
// 引擎為什麼留在那個檔名底下，見那支檔頭的說明——簡短版：CI 的跨瀏覽器提醒
// （#187）與 tests/browser 的真實瀏覽器覆蓋（#176）都盯著那條路徑。
//
// ⚠ 這一支**不是**安全邊界。它可以被繞過（直接打 API），所以 server 端的三道檢查與
// 2 MB 上限（`shared/utils/creaturePhotoUpload.ts`）一條都不能因為「反正前端縮過了」
// 而放寬。

/**
 * 沒有照片時的斜線佔位（庫存列表、詳情頁與新增／編輯表單共用同一款）。
 *
 * 三個畫面原本各寫一份一模一樣的字串（#154 之前）。留在同一個常數上的理由不是省字數，
 * 而是「還沒有照片」在三處看起來必須是同一件事——分岔的話，使用者會以為那是三種狀態。
 */
export const CREATURE_PHOTO_PLACEHOLDER
  = 'repeating-linear-gradient(135deg, rgba(148,163,184,0.16) 0 6px, transparent 6px 12px)'

/**
 * 長邊上限 1024 px，比頭像的 512 大一階。
 *
 * 頭像顯示不到 128 px，512 已經足夠 2× 螢幕；生物照片在詳情頁佔滿整個寬度
 *（手機上約 390 pt），512 會看得出糊。1024 在 3× 螢幕上仍略小於實際像素，
 * 但換到的是每張約 150–300 KB——列表頁一次載十幾張，這個取捨值得。
 */
export const CREATURE_PHOTO_MAX_EDGE = 1024

/** 生物照片的設定。檔名 photo.webp（退到 JPEG 時是 photo.jpg）。 */
export const CREATURE_PHOTO_RESIZE_OPTIONS: ImageResizeOptions = {
  maxEdge: CREATURE_PHOTO_MAX_EDGE,
  filenameBase: 'photo',
}

/**
 * 首選格式送出時的檔名。真正決定 Blob pathname 的是 server
 *（見 `buildCreaturePhotoPathname`），這個名字只用來讓 multipart 那一段有副檔名可讀。
 */
export const CREATURE_PHOTO_OUTPUT_FILENAME = 'photo.webp'

/** 生物照片：長邊 1024 px 的 WebP。失敗一律回傳原檔，理由見 `resizeImage`。 */
export async function resizeCreaturePhoto(file: File): Promise<ImageResizeResult> {
  return await resizeImage(file, CREATURE_PHOTO_RESIZE_OPTIONS)
}
