// @vitest-environment node
// 純函式測試，不碰 Vue 元件、Nuxt composable 或 DOM；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it } from 'vitest'
import {
  ALLOWED_AVATAR_CONTENT_TYPES,
  AVATAR_MAX_BYTES,
  AVATAR_MISSING_MESSAGE,
  AVATAR_TOO_LARGE_MESSAGE,
  AVATAR_UNSUPPORTED_MESSAGE,
  parseAvatarUpload,
} from '../../../shared/utils/avatarUpload'

// 頭像上傳的檔案規則（issue #166）。
//
// 這一支測的是「送進來的這個 part 能不能存」，完全不碰資料庫與 Blob store：
// 三道檢查（MIME、副檔名、magic bytes）與 2 MB 上限都是純粹的位元組判斷。
//
// ⚠ 這裡的每一條都是安全邊界，不是 UX。Epic #160 定案前端送出前一律縮到長邊 512 px
// 的 WebP（約 40–80 KB），所以正常流量根本碰不到 2 MB 那條線——會碰到它的是繞過前端
// 直接打 API 的請求，而那正是這些檢查存在的理由。

/** 各格式的檔頭。magic bytes 檢查看的就是這幾個位元組。 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
const JPEG_SIGNATURE = [0xFF, 0xD8, 0xFF, 0xE0]
const RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP = [0x57, 0x45, 0x42, 0x50]

const pngBytes = (padding = 16) => new Uint8Array([...PNG_SIGNATURE, ...Array.from({ length: padding }, () => 0)])
const jpegBytes = (padding = 16) => new Uint8Array([...JPEG_SIGNATURE, ...Array.from({ length: padding }, () => 0)])
/** RIFF....WEBP：位元組 0–3 是 RIFF、4–7 是長度、8–11 是 WEBP */
const webpBytes = (padding = 16) => new Uint8Array([...RIFF, 0, 0, 0, 0, ...WEBP, ...Array.from({ length: padding }, () => 0)])

function filePart(overrides: Partial<{ name: string, filename: string, type: string, data: Uint8Array }> = {}) {
  return {
    name: 'file',
    filename: 'avatar.png',
    type: 'image/png',
    data: pngBytes(),
    ...overrides,
  }
}

describe('parseAvatarUpload 的允許清單', () => {
  it('只接受 JPEG、PNG 與 WebP', () => {
    expect(ALLOWED_AVATAR_CONTENT_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp'])
  })

  it('上限是 2 MB', () => {
    expect(AVATAR_MAX_BYTES).toBe(2 * 1024 * 1024)
  })

  it.each([
    { label: 'PNG', filename: 'me.png', type: 'image/png', data: pngBytes(), extension: 'png' },
    { label: 'JPEG', filename: 'me.jpg', type: 'image/jpeg', data: jpegBytes(), extension: 'jpg' },
    { label: 'JPEG（.jpeg 副檔名）', filename: 'me.jpeg', type: 'image/jpeg', data: jpegBytes(), extension: 'jpg' },
    { label: 'WebP', filename: 'me.webp', type: 'image/webp', data: webpBytes(), extension: 'webp' },
  ])('$label 三道檢查都通過', ({ filename, type, data, extension }) => {
    const result = parseAvatarUpload([filePart({ filename, type, data })])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.contentType).toBe(type)
      expect(result.value.extension).toBe(extension)
      expect(result.value.data).toBe(data)
    }
  })

  // 副檔名比對不分大小寫：手機相簿常常給 IMG_0001.JPG
  it('副檔名大小寫不影響判斷', () => {
    expect(parseAvatarUpload([filePart({ filename: 'IMG_0001.JPG', type: 'image/jpeg', data: jpegBytes() })]).ok).toBe(true)
  })

  it('type 帶 charset 之類的參數時仍然認得出 MIME', () => {
    expect(parseAvatarUpload([filePart({ type: 'image/png; charset=binary' })]).ok).toBe(true)
  })
})

describe('parseAvatarUpload 拒絕的情況', () => {
  it('完全沒有檔案時回報 missing', () => {
    expect(parseAvatarUpload([])).toEqual({ ok: false, reason: 'missing', message: AVATAR_MISSING_MESSAGE })
    expect(parseAvatarUpload(undefined)).toEqual({ ok: false, reason: 'missing', message: AVATAR_MISSING_MESSAGE })
  })

  it('只有純文字欄位、沒有任何檔案時回報 missing', () => {
    expect(parseAvatarUpload([{ name: 'displayName', data: new Uint8Array([0x41]) }]))
      .toEqual({ ok: false, reason: 'missing', message: AVATAR_MISSING_MESSAGE })
  })

  // Story：超過 2 MB → 明確的 400，且必須與「格式不支援」分得開（UI 靠它挑文案，見 #168）
  it('超過 2 MB 回報 too-large，而不是 unsupported-format', () => {
    const oversized = new Uint8Array(AVATAR_MAX_BYTES + 1)
    oversized.set(PNG_SIGNATURE)

    expect(parseAvatarUpload([filePart({ data: oversized })]))
      .toEqual({ ok: false, reason: 'too-large', message: AVATAR_TOO_LARGE_MESSAGE })
  })

  it('剛好 2 MB 仍然通過——上限是「超過」才擋', () => {
    const exact = new Uint8Array(AVATAR_MAX_BYTES)
    exact.set(PNG_SIGNATURE)

    expect(parseAvatarUpload([filePart({ data: exact })]).ok).toBe(true)
  })

  // Story：SVG、GIF 或其他不在清單內的格式一律 400
  it.each([
    { label: 'SVG', filename: 'x.svg', type: 'image/svg+xml', data: new Uint8Array([0x3C, 0x73, 0x76, 0x67]) },
    { label: 'GIF', filename: 'x.gif', type: 'image/gif', data: new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) },
    { label: 'PDF', filename: 'x.pdf', type: 'application/pdf', data: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
    { label: '沒有 type', filename: 'x.png', type: undefined, data: pngBytes() },
  ])('$label 回報 unsupported-format', ({ filename, type, data }) => {
    expect(parseAvatarUpload([{ name: 'file', filename, type, data }]))
      .toEqual({ ok: false, reason: 'unsupported-format', message: AVATAR_UNSUPPORTED_MESSAGE })
  })

  // 只信瀏覽器給的 type 等於沒驗：SVG 改個副檔名、改個 type 就進來了
  it('宣稱 image/png 但副檔名是 .svg 時擋下來', () => {
    expect(parseAvatarUpload([filePart({ filename: 'payload.svg', type: 'image/png', data: pngBytes() })]))
      .toEqual({ ok: false, reason: 'unsupported-format', message: AVATAR_UNSUPPORTED_MESSAGE })
  })

  // Story：宣稱 image/png，但 magic bytes 不是 PNG → 400
  it('宣稱 image/png 但 magic bytes 是 SVG 文字時擋下來', () => {
    const svgSource = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')

    expect(parseAvatarUpload([filePart({ data: svgSource })]))
      .toEqual({ ok: false, reason: 'unsupported-format', message: AVATAR_UNSUPPORTED_MESSAGE })
  })

  it('宣稱 image/jpeg 但內容是 PNG 時擋下來——檔頭必須與 MIME 一致', () => {
    expect(parseAvatarUpload([filePart({ filename: 'me.jpg', type: 'image/jpeg', data: pngBytes() })]))
      .toEqual({ ok: false, reason: 'unsupported-format', message: AVATAR_UNSUPPORTED_MESSAGE })
  })

  it('RIFF 開頭但不是 WEBP 的容器（例如 WAV）擋下來', () => {
    const wav = new Uint8Array([...RIFF, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0, 0, 0, 0])

    expect(parseAvatarUpload([filePart({ filename: 'x.webp', type: 'image/webp', data: wav })]))
      .toEqual({ ok: false, reason: 'unsupported-format', message: AVATAR_UNSUPPORTED_MESSAGE })
  })

  it('位元組不足以判斷檔頭時擋下來，而不是當成通過', () => {
    expect(parseAvatarUpload([filePart({ data: new Uint8Array([0x89, 0x50]) })]))
      .toEqual({ ok: false, reason: 'unsupported-format', message: AVATAR_UNSUPPORTED_MESSAGE })

    expect(parseAvatarUpload([filePart({ data: new Uint8Array() })]))
      .toEqual({ ok: false, reason: 'unsupported-format', message: AVATAR_UNSUPPORTED_MESSAGE })
  })
})
