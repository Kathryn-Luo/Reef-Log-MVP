import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CREATURE_PHOTO_MAX_BYTES } from '#shared/utils/creaturePhotoUpload'
import { AVATAR_MAX_EDGE, AVATAR_OUTPUT_QUALITY, AVATAR_OUTPUT_TYPE } from '../../../app/utils/avatarImage'
import {
  CREATURE_PHOTO_MAX_EDGE,
  CREATURE_PHOTO_OUTPUT_FILENAME,
  resizeCreaturePhoto,
} from '../../../app/utils/creaturePhotoImage'

// 生物照片送出前的等比縮圖（issue #154）。
//
// 縮圖引擎與頭像共用同一份（`app/utils/avatarImage.ts` 的 `resizeImage`），這一支測的
// 是「生物照片這一組設定」：長邊 1024、檔名 photo.webp，以及失敗時同樣退回原檔。
// 引擎本身的每一條路徑由 resize-avatar.test.ts 顧著，這裡不重測一遍。
//
// 與那一支同樣的前提：`createImageBitmap`、`getContext('2d')`、`toBlob` 在 happy-dom
// 裡都不能用，所以三樣全部換成替身——斷言驗的是本函式算出來的長寬與送給編碼器的參數，
// 不是真的畫素。真實瀏覽器的覆蓋見 tests/browser/（#176）。

const canvas = {
  hasContext: true,
  encodable: ['image/webp', 'image/jpeg'] as string[],
  blobBytes: 4096,
  blobNull: false,
  encoded: [] as { width: number, height: number, type?: string, quality?: number }[],
}

const bitmap = {
  width: 4032,
  height: 3024,
  fail: false,
}

const originalGetContext = HTMLCanvasElement.prototype.getContext
const originalToBlob = HTMLCanvasElement.prototype.toBlob

beforeEach(() => {
  canvas.hasContext = true
  canvas.encodable = ['image/webp', 'image/jpeg']
  canvas.blobBytes = 4096
  canvas.blobNull = false
  canvas.encoded = []

  bitmap.width = 4032
  bitmap.height = 3024
  bitmap.fail = false

  vi.stubGlobal('createImageBitmap', vi.fn(async () => {
    if (bitmap.fail) {
      throw new TypeError('The source image could not be decoded.')
    }

    return { width: bitmap.width, height: bitmap.height, close: () => {} }
  }))

  HTMLCanvasElement.prototype.getContext = function () {
    return canvas.hasContext ? { drawImage: () => {} } : null
  } as unknown as typeof originalGetContext

  HTMLCanvasElement.prototype.toBlob = function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string,
    quality?: number,
  ) {
    canvas.encoded.push({ width: this.width, height: this.height, type, quality })

    const produced = canvas.encodable.includes(type ?? '') ? type! : 'image/png'

    callback(canvas.blobNull ? null : new Blob([new Uint8Array(canvas.blobBytes)], { type: produced }))
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  HTMLCanvasElement.prototype.getContext = originalGetContext
  HTMLCanvasElement.prototype.toBlob = originalToBlob
})

/** 一張「手機隨手拍」等級的原檔：6 MB、JPEG */
function photo(bytes = 6 * 1024 * 1024): File {
  return new File([new Uint8Array(bytes)], 'IMG_4823.JPG', { type: 'image/jpeg' })
}

describe('resizeCreaturePhoto', () => {
  // Given 我從相簿選了一張 6 MB、長邊 4032 px 的手機照片
  // When  表單送出前先縮圖
  // Then  送出的是長邊 1024 px 的 WebP，遠小於 server 的 2 MB 上限
  it('長邊縮到 1024 px，短邊依原比例等比縮小', async () => {
    const original = photo()

    const { file: resized, outcome } = await resizeCreaturePhoto(original)

    expect(outcome).toBe('resized')
    // 4032 × 3024（4:3）→ 1024 × 768
    expect(canvas.encoded).toEqual([
      { width: CREATURE_PHOTO_MAX_EDGE, height: 768, type: AVATAR_OUTPUT_TYPE, quality: AVATAR_OUTPUT_QUALITY },
    ])
    expect(resized.type).toBe(AVATAR_OUTPUT_TYPE)
    expect(resized.name).toBe(CREATURE_PHOTO_OUTPUT_FILENAME)
    expect(resized).not.toBe(original)
    expect(resized.size).toBeLessThan(CREATURE_PHOTO_MAX_BYTES)
  })

  // 生物照片在詳情頁佔滿整個寬度，而頭像顯示不到 128 px——同一個長邊會讓照片糊掉。
  // 兩組設定因此刻意不同，這一條守的是「它們沒有被合併成同一個數字」。
  it('比頭像大一階：長邊 1024 而不是 512', () => {
    expect(CREATURE_PHOTO_MAX_EDGE).toBe(1024)
    expect(CREATURE_PHOTO_MAX_EDGE).toBeGreaterThan(AVATAR_MAX_EDGE)
  })

  it('直式照片縮的是高，寬跟著等比縮', async () => {
    bitmap.width = 3024
    bitmap.height = 4032

    await resizeCreaturePhoto(photo())

    expect(canvas.encoded[0]).toMatchObject({ width: 768, height: CREATURE_PHOTO_MAX_EDGE })
  })

  it('比 1024 小的圖維持原尺寸，不放大', async () => {
    bitmap.width = 640
    bitmap.height = 480

    await resizeCreaturePhoto(photo(80 * 1024))

    expect(canvas.encoded[0]).toMatchObject({ width: 640, height: 480 })
  })

  // 副檔名要跟著 MIME 走：server 的三道檢查要 MIME、副檔名、magic bytes 三者一致，
  // 一份 JPEG 頂著 .webp 的名字會被當成「格式不支援」退件
  it('編碼不出 WebP 時改送縮好的 JPEG，檔名跟著換', async () => {
    canvas.encodable = ['image/jpeg']

    const { file: resized } = await resizeCreaturePhoto(photo())

    expect(resized.type).toBe('image/jpeg')
    expect(resized.name).toBe('photo.jpg')
  })

  // 失敗一律回原檔、不丟例外：送出去讓 server 判，總比在前端把人卡住好
  it.each([
    { label: '解碼失敗', arrange: () => { bitmap.fail = true }, outcome: 'decode-failed' },
    { label: '沒有 2D context', arrange: () => { canvas.hasContext = false }, outcome: 'no-canvas-context' },
    { label: '編碼失敗', arrange: () => { canvas.encodable = [] }, outcome: 'encode-failed' },
  ])('$label 時回傳原本的 File，不往外拋', async ({ arrange, outcome }) => {
    arrange()
    const original = photo()

    expect(await resizeCreaturePhoto(original)).toEqual({ file: original, outcome })
  })
})
