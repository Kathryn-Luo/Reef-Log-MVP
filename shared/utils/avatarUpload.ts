// 頭像上傳的檔案規則（issue #166）。
//
// 住在 shared 而不是 server：上限與允許清單同時是「UI 該顯示什麼」與「server 該擋什麼」，
// 兩邊各寫一份的話遲早分岔——前端說可以、server 說不行，而使用者只看得到後者
// （上傳 UI 是 #168）。`parseDisplayName` 也是同一個安排。
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

export type AvatarContentType = 'image/jpeg' | 'image/png' | 'image/webp'
export type AvatarExtension = 'jpg' | 'png' | 'webp'

/**
 * 為什麼是這三種：JPEG / PNG / WebP 都是**點陣**格式，瀏覽器只會把它們解碼成像素。
 *
 * SVG 一定要在清單外——它是標記語言，`<script>` 會被當成可執行的內容處理，
 * 而 Blob 是同一個網域下可公開讀取的 URL。GIF 只是「沒有必要」：頭像不需要動畫，
 * 少一種格式就少一種要驗的檔頭。
 */
export const ALLOWED_AVATAR_CONTENT_TYPES: AvatarContentType[] = ['image/jpeg', 'image/png', 'image/webp']

/** multipart 的一個 part。形狀取 h3 `readMultipartFormData()` 回傳的子集。 */
export interface AvatarUploadPart {
  name?: string
  filename?: string
  type?: string
  data: Uint8Array
}

export interface ValidatedAvatar {
  data: Uint8Array
  contentType: AvatarContentType
  /** 存進 Blob pathname 的副檔名，由 MIME 決定，不採用使用者送來的檔名 */
  extension: AvatarExtension
}

/**
 * 拒絕的理由。**「太大」與「格式不支援」必須分得開**：UI 靠它挑文案（#168），
 * 折成同一種的話，使用者換一張小圖再試一次仍然被擋，而畫面說的是同一句話。
 */
export type AvatarUploadRejection = 'missing' | 'too-large' | 'unsupported-format'

export type ParseAvatarUploadResult
  = | { ok: true, value: ValidatedAvatar }
    | { ok: false, reason: AvatarUploadRejection, message: string }

interface AvatarFormat {
  contentType: AvatarContentType
  extension: AvatarExtension
  /** 可接受的檔名副檔名（小寫）。JPEG 兩種寫法都常見。 */
  filenameExtensions: string[]
  /** magic bytes：內容真的是這個格式嗎 */
  hasSignature: (bytes: Uint8Array) => boolean
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

const FORMATS: AvatarFormat[] = [
  {
    contentType: 'image/jpeg',
    extension: 'jpg',
    filenameExtensions: ['jpg', 'jpeg'],
    hasSignature: bytes => startsWith(bytes, [0xFF, 0xD8, 0xFF]),
  },
  {
    contentType: 'image/png',
    extension: 'png',
    filenameExtensions: ['png'],
    hasSignature: bytes => startsWith(bytes, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  },
  {
    // WebP 是 RIFF 容器：位元組 0–3 是 `RIFF`、4–7 是長度、8–11 才是 `WEBP`。
    // 只看 RIFF 的話，WAV 與 AVI 也會通過。
    contentType: 'image/webp',
    extension: 'webp',
    filenameExtensions: ['webp'],
    hasSignature: bytes => startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
      && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8),
  },
]

/** `image/png; charset=binary` → `image/png`；大小寫與前後空白一併正規化 */
function normalizeContentType(raw: string | undefined): string {
  return (raw ?? '').split(';')[0]!.trim().toLowerCase()
}

function filenameExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase()
}

function reject(reason: AvatarUploadRejection, message: string): ParseAvatarUploadResult {
  return { ok: false, reason, message }
}

/**
 * 三道檢查全部通過才算數：宣告的 MIME、檔名副檔名、magic bytes。
 *
 * 少任何一道都等於沒驗：只看 `type` 的話，改個 header 就送得進 SVG；只看副檔名的話，
 * 改個檔名就行；只看 magic bytes 的話，一張真的 PNG 可以掛著 `.svg` 的名字存進 store，
 * 之後被當成 SVG 提供出去。三者互相牽制，任何一項對不上就整個拒絕。
 */
export function parseAvatarUpload(parts: AvatarUploadPart[] | null | undefined): ParseAvatarUploadResult {
  const files = (parts ?? []).filter(part => typeof part.filename === 'string' && part.filename !== '')
  const file = files.find(part => part.name === AVATAR_FIELD_NAME) ?? files[0]

  if (!file) {
    return reject('missing', AVATAR_MISSING_MESSAGE)
  }

  // 大小先驗：它與格式無關，而且是唯一一個「換一張圖就能解決」的理由
  if (file.data.byteLength > AVATAR_MAX_BYTES) {
    return reject('too-large', AVATAR_TOO_LARGE_MESSAGE)
  }

  const contentType = normalizeContentType(file.type)
  const format = FORMATS.find(candidate => candidate.contentType === contentType)

  if (!format
    || !format.filenameExtensions.includes(filenameExtension(file.filename!))
    || !format.hasSignature(file.data)) {
    return reject('unsupported-format', AVATAR_UNSUPPORTED_MESSAGE)
  }

  return {
    ok: true,
    value: { data: file.data, contentType: format.contentType, extension: format.extension },
  }
}
