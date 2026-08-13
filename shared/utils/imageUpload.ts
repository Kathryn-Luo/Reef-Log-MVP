// 圖片上傳的共用規則引擎（issue #154 從 avatarUpload.ts 抽出）。
//
// 原本這一整套三道檢查只服務頭像（#166）。生物照片（#154）要的是**同一套判斷、
// 不同的設定**：同樣三種點陣格式、同樣的 magic bytes，但訊息講的是「照片」、
// 上限日後也可能各自調整。抽出來的理由與當初把規則放進 shared 的理由是同一個——
// 兩邊各寫一份的話遲早分岔，而分岔的那一天，被放進 store 的會是沒人驗過的位元組。
//
// 所以這裡放「怎麼驗」，`avatarUpload.ts` 與 `creaturePhotoUpload.ts` 各放「驗什麼」。
//
// ⚠ 這裡的每一條都是**安全邊界**，不是 UX。前端送出前的縮圖可以被繞過（直接打 API），
// 這一份不行，因此不可因為「反正前端縮過了」就把任何一關拿掉或放寬。

export type ImageContentType = 'image/jpeg' | 'image/png' | 'image/webp'
export type ImageExtension = 'jpg' | 'png' | 'webp'

/**
 * 為什麼是這三種：JPEG / PNG / WebP 都是**點陣**格式，瀏覽器只會把它們解碼成像素。
 *
 * SVG 一定要在清單外——它是標記語言，`<script>` 會被當成可執行的內容處理，
 * 而 Blob 是同一個網域下可公開讀取的 URL。GIF 只是「沒有必要」：頭像與生物照片
 * 都不需要動畫，少一種格式就少一種要驗的檔頭。
 */
export const ALLOWED_IMAGE_CONTENT_TYPES: ImageContentType[] = ['image/jpeg', 'image/png', 'image/webp']

/** multipart 的一個 part。形狀取 h3 `readMultipartFormData()` 回傳的子集。 */
export interface ImageUploadPart {
  name?: string
  filename?: string
  type?: string
  data: Uint8Array
}

export interface ValidatedImage {
  data: Uint8Array
  contentType: ImageContentType
  /** 存進 Blob pathname 的副檔名，由 MIME 決定，不採用使用者送來的檔名 */
  extension: ImageExtension
}

/**
 * 拒絕的理由。**「太大」與「格式不支援」必須分得開**：UI 靠它挑文案，
 * 折成同一種的話，使用者換一張小圖再試一次仍然被擋，而畫面說的是同一句話。
 */
export type ImageUploadRejection = 'missing' | 'too-large' | 'unsupported-format'

export type ParseImageUploadResult
  = | { ok: true, value: ValidatedImage }
    | { ok: false, reason: ImageUploadRejection, message: string }

/** 一種用途（頭像、生物照片…）的設定：欄位名、上限，以及三種退件各自的說法。 */
export interface ImageUploadRules {
  /** multipart 裡放圖片的欄位名。UI 與 API 共用同一個名字，才不必靠「第一個欄位」猜。 */
  fieldName: string
  maxBytes: number
  messages: Record<ImageUploadRejection, string>
}

interface ImageFormat {
  contentType: ImageContentType
  extension: ImageExtension
  /** 可接受的檔名副檔名（小寫）。JPEG 兩種寫法都常見。 */
  filenameExtensions: string[]
  /** magic bytes：內容真的是這個格式嗎 */
  hasSignature: (bytes: Uint8Array) => boolean
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

const FORMATS: ImageFormat[] = [
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

/**
 * 三道檢查全部通過才算數：宣告的 MIME、檔名副檔名、magic bytes。
 *
 * 少任何一道都等於沒驗：只看 `type` 的話，改個 header 就送得進 SVG；只看副檔名的話，
 * 改個檔名就行；只看 magic bytes 的話，一張真的 PNG 可以掛著 `.svg` 的名字存進 store，
 * 之後被當成 SVG 提供出去。三者互相牽制，任何一項對不上就整個拒絕。
 */
export function parseImageUpload(
  parts: ImageUploadPart[] | null | undefined,
  rules: ImageUploadRules,
): ParseImageUploadResult {
  const reject = (reason: ImageUploadRejection): ParseImageUploadResult =>
    ({ ok: false, reason, message: rules.messages[reason] })

  const files = (parts ?? []).filter(part => typeof part.filename === 'string' && part.filename !== '')
  const file = files.find(part => part.name === rules.fieldName) ?? files[0]

  if (!file) {
    return reject('missing')
  }

  // 大小先驗：它與格式無關，而且是唯一一個「換一張圖就能解決」的理由
  if (file.data.byteLength > rules.maxBytes) {
    return reject('too-large')
  }

  const contentType = normalizeContentType(file.type)
  const format = FORMATS.find(candidate => candidate.contentType === contentType)

  if (!format
    || !format.filenameExtensions.includes(filenameExtension(file.filename!))
    || !format.hasSignature(file.data)) {
    return reject('unsupported-format')
  }

  return {
    ok: true,
    value: { data: file.data, contentType: format.contentType, extension: format.extension },
  }
}
