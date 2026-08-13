import type { ImageUploadPart, ImageUploadRules, ParseImageUploadResult } from './imageUpload'
import { ALLOWED_IMAGE_CONTENT_TYPES, parseImageUpload } from './imageUpload'

// 生物照片上傳的檔案規則（issue #154）。
//
// 與頭像（`avatarUpload.ts`）同一個安排：規則住在 shared，因為它同時是
// 「表單該顯示什麼」與「server 該擋什麼」。兩邊各寫一份的話遲早分岔，
// 而使用者只看得到 server 那一邊的答案。
//
// 三道檢查（MIME、副檔名、magic bytes）的實作在 `imageUpload.ts`，與頭像共用；
// 這一支只放生物照片這一組設定。
//
// ⚠ 這裡的每一條都是**安全邊界**，不是 UX。表單送出前會先等比縮圖
// （`app/utils/avatarImage.ts` 的 `resizeImage`，長邊 1024 的 WebP 約 150–300 KB），
// 所以正常流量離 2 MB 遠得很——會碰到這些檢查的是繞過前端直接打 API 的請求。

/**
 * 單檔上限 2 MB，與頭像同一個數字、同一個理由：低於 Vercel Function 的 4.5 MB
 * request body 限制，撞到平台那條線時回來的是一頁分不出原因的平台錯誤。
 *
 * 生物照片比頭像大（長邊 1024 而不是 512），但縮圖後仍然遠低於這條線。
 */
export const CREATURE_PHOTO_MAX_BYTES = 2 * 1024 * 1024

/** multipart 裡放照片的欄位名。表單與 API 共用同一個名字，才不必靠「第一個欄位」猜。 */
export const CREATURE_PHOTO_FIELD_NAME = 'file'

export const CREATURE_PHOTO_MISSING_MESSAGE = '請選擇要上傳的照片。'
export const CREATURE_PHOTO_TOO_LARGE_MESSAGE = '照片請控制在 2 MB 以內。'
export const CREATURE_PHOTO_UNSUPPORTED_MESSAGE = '照片只接受 JPEG、PNG 或 WebP 圖片。'

/** 三種點陣格式，理由見 `ALLOWED_IMAGE_CONTENT_TYPES`（SVG 一定要在清單外）。 */
export const ALLOWED_CREATURE_PHOTO_CONTENT_TYPES = ALLOWED_IMAGE_CONTENT_TYPES

/**
 * 生物照片這一組設定。
 *
 * 訊息刻意與頭像各寫一份而不是共用一句通用的「圖片」：使用者看到的是自己剛才在做
 * 的那件事（換照片 / 換頭像），而同一句話套兩個場景，讀起來永遠有一邊是錯的。
 */
export const CREATURE_PHOTO_UPLOAD_RULES: ImageUploadRules = {
  fieldName: CREATURE_PHOTO_FIELD_NAME,
  maxBytes: CREATURE_PHOTO_MAX_BYTES,
  messages: {
    'missing': CREATURE_PHOTO_MISSING_MESSAGE,
    'too-large': CREATURE_PHOTO_TOO_LARGE_MESSAGE,
    'unsupported-format': CREATURE_PHOTO_UNSUPPORTED_MESSAGE,
  },
}

/** 三道檢查全部通過才算數，實作見 `parseImageUpload`。 */
export function parseCreaturePhotoUpload(parts: ImageUploadPart[] | null | undefined): ParseImageUploadResult {
  return parseImageUpload(parts, CREATURE_PHOTO_UPLOAD_RULES)
}
