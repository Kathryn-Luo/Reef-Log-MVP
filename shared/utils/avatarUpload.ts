import type {
  ImageContentType,
  ImageExtension,
  ImageUploadPart,
  ImageUploadRejection,
  ImageUploadRules,
  ParseImageUploadResult,
  ValidatedImage,
} from './imageUpload'
import { ALLOWED_IMAGE_CONTENT_TYPES, parseImageUpload } from './imageUpload'

// 頭像上傳的檔案規則（issue #166）。
//
// 住在 shared 而不是 server：上限與允許清單同時是「UI 該顯示什麼」與「server 該擋什麼」，
// 兩邊各寫一份的話遲早分岔——前端說可以、server 說不行，而使用者只看得到後者
// （上傳 UI 是 #168）。`parseDisplayName` 也是同一個安排。
//
// 三道檢查（MIME、副檔名、magic bytes）本身自 issue #154 起住在 `imageUpload.ts`，
// 與生物照片共用；這一支留下的是「頭像這一組設定」：欄位名、上限與三種退件的說法。
//
// ⚠ 這裡的每一條都是**安全邊界**，不是 UX。Epic #160 定案前端送出前一律等比縮到
// 長邊 512 px 的 WebP（約 40–80 KB），所以正常流量離 2 MB 遠得很——會碰到這些檢查的
// 是繞過前端直接打 API 的請求。前端縮圖可以被繞過，這一份不行，因此**不可**因為
// 「反正前端縮過了」就把任何一關拿掉或放寬。

/**
 * 單檔上限 2 MB，低於 Vercel Function 的 4.5 MB request body 限制。
 *
 * 兩者的差距是刻意的：撞到平台那條線時回來的是一頁平台自己的錯誤，
 * 分不出「太大」與「壞掉了」；撞到這一條回來的是下面那句話。
 */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

/** multipart 裡放圖片的欄位名。UI 與 API 共用同一個名字，才不必靠「第一個欄位」猜。 */
export const AVATAR_FIELD_NAME = 'file'

export const AVATAR_MISSING_MESSAGE = '請選擇要上傳的圖片。'
export const AVATAR_TOO_LARGE_MESSAGE = '圖片請控制在 2 MB 以內。'
export const AVATAR_UNSUPPORTED_MESSAGE = '頭像只接受 JPEG、PNG 或 WebP 圖片。'

export type AvatarContentType = ImageContentType
export type AvatarExtension = ImageExtension

/** 三種點陣格式，理由見 `ALLOWED_IMAGE_CONTENT_TYPES`（SVG 一定要在清單外）。 */
export const ALLOWED_AVATAR_CONTENT_TYPES: AvatarContentType[] = ALLOWED_IMAGE_CONTENT_TYPES

export type AvatarUploadPart = ImageUploadPart
export type ValidatedAvatar = ValidatedImage
export type AvatarUploadRejection = ImageUploadRejection
export type ParseAvatarUploadResult = ParseImageUploadResult

/**
 * 頭像這一組設定。
 *
 * 與生物照片的那一組（`CREATURE_PHOTO_UPLOAD_RULES`）刻意各自獨立：日後只調其中
 * 一邊的上限時，另一邊不該跟著變。共用的是規則引擎，不是數值。
 */
export const AVATAR_UPLOAD_RULES: ImageUploadRules = {
  fieldName: AVATAR_FIELD_NAME,
  maxBytes: AVATAR_MAX_BYTES,
  messages: {
    'missing': AVATAR_MISSING_MESSAGE,
    'too-large': AVATAR_TOO_LARGE_MESSAGE,
    'unsupported-format': AVATAR_UNSUPPORTED_MESSAGE,
  },
}

/** 三道檢查全部通過才算數，實作見 `parseImageUpload`。 */
export function parseAvatarUpload(parts: AvatarUploadPart[] | null | undefined): ParseAvatarUploadResult {
  return parseImageUpload(parts, AVATAR_UPLOAD_RULES)
}
