// @vitest-environment node
// 純函式測試，不碰 Vue 元件、Nuxt composable 或 DOM；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it } from 'vitest'
import {
  ALLOWED_CREATURE_PHOTO_CONTENT_TYPES,
  CREATURE_PHOTO_MAX_BYTES,
  CREATURE_PHOTO_MISSING_MESSAGE,
  CREATURE_PHOTO_TOO_LARGE_MESSAGE,
  CREATURE_PHOTO_UNSUPPORTED_MESSAGE,
  parseCreaturePhotoUpload,
} from '../../../shared/utils/creaturePhotoUpload'
import { AVATAR_MAX_BYTES, parseAvatarUpload } from '../../../shared/utils/avatarUpload'

// 生物照片上傳的檔案規則（issue #154）。
//
// 規則本體與頭像（#166）共用 shared/utils/imageUpload.ts 的同一份三道檢查
// （MIME、副檔名、magic bytes）與大小上限，這一支測的是「生物照片這一組設定」
// 真的接上了那份規則，而且訊息是照片的用語、不是頭像的。
//
// ⚠ 這裡的每一條都是安全邊界，不是 UX。表單送出前會先等比縮圖（app/utils），
// 但那可以被繞過——會碰到這些檢查的正是直接打 API 的請求。

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
const JPEG_SIGNATURE = [0xFF, 0xD8, 0xFF, 0xE0]
const RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP = [0x57, 0x45, 0x42, 0x50]

const pngBytes = (padding = 16) => new Uint8Array([...PNG_SIGNATURE, ...Array.from({ length: padding }, () => 0)])
const jpegBytes = (padding = 16) => new Uint8Array([...JPEG_SIGNATURE, ...Array.from({ length: padding }, () => 0)])
const webpBytes = (padding = 16) => new Uint8Array([...RIFF, 0, 0, 0, 0, ...WEBP, ...Array.from({ length: padding }, () => 0)])

function filePart(overrides: Partial<{ name: string, filename: string, type: string, data: Uint8Array }> = {}) {
  return {
    name: 'file',
    filename: 'photo.png',
    type: 'image/png',
    data: pngBytes(),
    ...overrides,
  }
}

describe('parseCreaturePhotoUpload：接受的檔案', () => {
  it.each([
    { label: 'PNG', filename: 'fish.png', type: 'image/png', data: pngBytes(), extension: 'png' },
    { label: 'JPEG', filename: 'fish.jpg', type: 'image/jpeg', data: jpegBytes(), extension: 'jpg' },
    { label: 'JPEG（.jpeg）', filename: 'fish.jpeg', type: 'image/jpeg', data: jpegBytes(), extension: 'jpg' },
    { label: 'WebP', filename: 'fish.webp', type: 'image/webp', data: webpBytes(), extension: 'webp' },
  ])('$label 通過，副檔名由 MIME 決定', ({ filename, type, data, extension }) => {
    const result = parseCreaturePhotoUpload([filePart({ filename, type, data })])

    expect(result).toEqual({ ok: true, value: { data, contentType: type, extension } })
  })

  it('允許清單就是三種點陣格式，SVG 不在其中', () => {
    expect(ALLOWED_CREATURE_PHOTO_CONTENT_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp'])
  })
})

// Story：Given 我選的檔案不是允許的圖片型別，或超過大小上限
//        When  我嘗試上傳 / Then 顯示錯誤訊息，儲存被阻擋
//
// 「顯示」是前端的事，這一層要給的是它顯示得出來的東西：分得開的理由與一句人話。
describe('parseCreaturePhotoUpload：退件', () => {
  it('沒有檔案時 reason 是 missing', () => {
    expect(parseCreaturePhotoUpload([])).toEqual({
      ok: false,
      reason: 'missing',
      message: CREATURE_PHOTO_MISSING_MESSAGE,
    })
  })

  it('只有純文字欄位、沒有檔案時同樣是 missing', () => {
    const result = parseCreaturePhotoUpload([{ name: 'name', data: new TextEncoder().encode('火焰仙') }])

    expect(result).toEqual({ ok: false, reason: 'missing', message: CREATURE_PHOTO_MISSING_MESSAGE })
  })

  it('超過上限時 reason 是 too-large', () => {
    const oversized = new Uint8Array(CREATURE_PHOTO_MAX_BYTES + 1)
    oversized.set(PNG_SIGNATURE)

    expect(parseCreaturePhotoUpload([filePart({ data: oversized })])).toEqual({
      ok: false,
      reason: 'too-large',
      message: CREATURE_PHOTO_TOO_LARGE_MESSAGE,
    })
  })

  it('剛好等於上限時通過（邊界是「超過」才退）', () => {
    const exact = new Uint8Array(CREATURE_PHOTO_MAX_BYTES)
    exact.set(PNG_SIGNATURE)

    expect(parseCreaturePhotoUpload([filePart({ data: exact })]).ok).toBe(true)
  })

  it.each([
    { label: 'SVG', filename: 'x.svg', type: 'image/svg+xml', data: new Uint8Array([0x3C, 0x73, 0x76, 0x67]) },
    { label: 'GIF', filename: 'x.gif', type: 'image/gif', data: new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) },
    { label: '宣稱 PNG 但檔名是 .svg', filename: 'x.svg', type: 'image/png', data: pngBytes() },
    { label: '宣稱 PNG 但內容是 SVG', filename: 'x.png', type: 'image/png', data: new TextEncoder().encode('<svg></svg>') },
    { label: '宣稱 WebP 但只有 RIFF（其實是 WAV）', filename: 'x.webp', type: 'image/webp', data: new Uint8Array([...RIFF, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]) },
  ])('$label 退件，reason 是 unsupported-format', ({ filename, type, data }) => {
    expect(parseCreaturePhotoUpload([filePart({ filename, type, data })])).toEqual({
      ok: false,
      reason: 'unsupported-format',
      message: CREATURE_PHOTO_UNSUPPORTED_MESSAGE,
    })
  })

  // 三道檢查缺一不可，所以「太大」要排在格式之前：一張 3 MB 的合格 JPEG
  // 拿到「格式不支援」的話，使用者會換格式而不是換一張小圖。
  it('又大又不合格時先說「太大」', () => {
    const oversized = new Uint8Array(CREATURE_PHOTO_MAX_BYTES + 1)

    expect(parseCreaturePhotoUpload([filePart({ filename: 'x.gif', type: 'image/gif', data: oversized })]))
      .toMatchObject({ ok: false, reason: 'too-large' })
  })
})

describe('parseCreaturePhotoUpload：欄位名', () => {
  it('認名為 file 的那一個 part，不是「第一個檔案」', () => {
    const wanted = filePart({ name: 'file', filename: 'wanted.png', data: pngBytes(8) })
    const other = filePart({ name: 'other', filename: 'other.png', data: pngBytes(24) })

    expect(parseCreaturePhotoUpload([other, wanted])).toMatchObject({ ok: true, value: { data: wanted.data } })
  })
})

// 照片與頭像共用同一份規則引擎，但**各有各的設定**：日後要把照片上限調成 4 MB
// 時，頭像不該跟著變。這一條守的是「設定是分開的」這件事本身。
describe('與頭像的關係', () => {
  it('訊息是照片的用語，不是頭像的', () => {
    expect(CREATURE_PHOTO_UNSUPPORTED_MESSAGE).toContain('照片')
    expect(CREATURE_PHOTO_UNSUPPORTED_MESSAGE).not.toContain('頭像')
    expect(CREATURE_PHOTO_TOO_LARGE_MESSAGE).toContain('照片')
  })

  it('兩支 parse 各自獨立，退件訊息不會互相污染', () => {
    const gif = filePart({ filename: 'x.gif', type: 'image/gif', data: new Uint8Array([0x47, 0x49, 0x46]) })

    expect(parseCreaturePhotoUpload([gif])).toMatchObject({ message: CREATURE_PHOTO_UNSUPPORTED_MESSAGE })
    expect(parseAvatarUpload([gif])).toMatchObject({ message: expect.stringContaining('頭像') })
  })

  it('目前兩者的上限相同，都低於 Vercel Function 的 4.5 MB request body 限制', () => {
    expect(CREATURE_PHOTO_MAX_BYTES).toBe(AVATAR_MAX_BYTES)
    expect(CREATURE_PHOTO_MAX_BYTES).toBeLessThan(4.5 * 1024 * 1024)
  })
})
