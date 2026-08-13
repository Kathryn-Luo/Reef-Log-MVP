import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AVATAR_MAX_BYTES } from '#shared/utils/avatarUpload'
import {
  AVATAR_MAX_EDGE,
  AVATAR_OUTPUT_FILENAME,
  AVATAR_OUTPUT_QUALITY,
  AVATAR_OUTPUT_TYPE,
  resizeAvatar,
} from '../../../app/utils/avatarImage'

// 上傳前的等比縮圖（issue #168）。
//
// 這一段在 jsdom / happy-dom 裡「本來就跑不起來」：`createImageBitmap` 認不得 File、
// `getContext('2d')` 回 null、`toBlob` 給的是一個 0 byte 的空 Blob。所以瀏覽器那三樣
// 東西全部換成替身——**替身只負責回報尺寸與參數**，斷言驗的是本函式自己算出來的
// 長寬、送給編碼器的格式與品質，以及每一條失敗路徑的退場方式。
//
// 真正的縮圖畫質、EXIF 方向與 iOS 的原生選單只有真實瀏覽器驗得到（見 #176 與
// 本 issue 的「手機的原生檔案選單與 EXIF 方向由人類在實機上確認一次」）。

interface DrawCall {
  width: number
  height: number
}

const canvas = {
  /** getContext('2d') 給不給得出 context。false＝這個瀏覽器沒有 2D canvas */
  hasContext: true,
  /** toBlob 實際回傳的 MIME。瀏覽器不支援 WebP 編碼時會自己退回 image/png */
  blobType: 'image/webp',
  blobBytes: 4096,
  /** toBlob 回 null：畫布太大或編碼失敗 */
  blobNull: false,
  drawn: [] as DrawCall[],
  encoded: [] as { width: number, height: number, type?: string, quality?: number }[],
}

const bitmap = {
  width: 4032,
  height: 3024,
  /** createImageBitmap 丟例外：不支援，或這個檔案解不開 */
  fail: false,
  options: [] as (ImageBitmapOptions | undefined)[],
  closed: 0,
}

const originalGetContext = HTMLCanvasElement.prototype.getContext
const originalToBlob = HTMLCanvasElement.prototype.toBlob

beforeEach(() => {
  canvas.hasContext = true
  canvas.blobType = 'image/webp'
  canvas.blobBytes = 4096
  canvas.blobNull = false
  canvas.drawn = []
  canvas.encoded = []

  bitmap.width = 4032
  bitmap.height = 3024
  bitmap.fail = false
  bitmap.options = []
  bitmap.closed = 0

  vi.stubGlobal('createImageBitmap', vi.fn(async (_source: unknown, options?: ImageBitmapOptions) => {
    bitmap.options.push(options)

    if (bitmap.fail) {
      throw new TypeError('The source image could not be decoded.')
    }

    return {
      width: bitmap.width,
      height: bitmap.height,
      close: () => {
        bitmap.closed += 1
      },
    }
  }))

  HTMLCanvasElement.prototype.getContext = function () {
    return canvas.hasContext
      ? {
          drawImage: (_image: unknown, _x: number, _y: number, width: number, height: number) => {
            canvas.drawn.push({ width, height })
          },
        }
      : null
  } as unknown as typeof originalGetContext

  HTMLCanvasElement.prototype.toBlob = function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string,
    quality?: number,
  ) {
    canvas.encoded.push({ width: this.width, height: this.height, type, quality })
    callback(canvas.blobNull ? null : new Blob([new Uint8Array(canvas.blobBytes)], { type: canvas.blobType }))
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

describe('resizeAvatar', () => {
  // Given 我從相簿選了一張 6 MB、長邊 4032 px 的手機照片
  // When  前端處理完並送出
  // Then  實際送出的是長邊 512 px 的 WebP、體積遠小於 2 MB
  it('長邊縮到 512 px，短邊依原比例等比縮小', async () => {
    const original = photo()

    const resized = await resizeAvatar(original)

    // 4032 × 3024（4:3）→ 512 × 384
    expect(canvas.encoded).toEqual([
      { width: AVATAR_MAX_EDGE, height: 384, type: AVATAR_OUTPUT_TYPE, quality: AVATAR_OUTPUT_QUALITY },
    ])
    expect(canvas.drawn).toEqual([{ width: AVATAR_MAX_EDGE, height: 384 }])
    expect(resized.type).toBe(AVATAR_OUTPUT_TYPE)
    expect(resized.name).toBe(AVATAR_OUTPUT_FILENAME)

    // 送出的是重新編碼的那一份，不是原檔
    expect(resized).not.toBe(original)
    expect(resized.size).toBe(canvas.blobBytes)
    expect(resized.size).toBeLessThan(original.size)
    expect(resized.size).toBeLessThan(AVATAR_MAX_BYTES)
  })

  it('直式照片縮的是高，寬跟著等比縮', async () => {
    bitmap.width = 3024
    bitmap.height = 4032

    await resizeAvatar(photo())

    expect(canvas.encoded[0]).toMatchObject({ width: 384, height: AVATAR_MAX_EDGE })
  })

  it('正方形照片縮成 512 × 512', async () => {
    bitmap.width = 1024
    bitmap.height = 1024

    await resizeAvatar(photo())

    expect(canvas.encoded[0]).toMatchObject({ width: AVATAR_MAX_EDGE, height: AVATAR_MAX_EDGE })
  })

  // Given 我選了一張已經很小的圖（例如 200 px）
  // When  前端處理
  // Then  不放大，維持原尺寸送出（縮圖只縮不放）
  it('比 512 小的圖維持原尺寸，不放大', async () => {
    bitmap.width = 200
    bitmap.height = 120

    const resized = await resizeAvatar(photo(30 * 1024))

    expect(canvas.encoded[0]).toMatchObject({ width: 200, height: 120 })
    expect(canvas.drawn).toEqual([{ width: 200, height: 120 }])
    expect(resized.type).toBe(AVATAR_OUTPUT_TYPE)
  })

  it('長邊剛好 512 px 時原尺寸輸出', async () => {
    bitmap.width = AVATAR_MAX_EDGE
    bitmap.height = 256

    await resizeAvatar(photo())

    expect(canvas.encoded[0]).toMatchObject({ width: AVATAR_MAX_EDGE, height: 256 })
  })

  // 這一條**不是**「頭像不會躺著」那條 Then 的證明，別把它當成證明（PR #185 的 review）。
  //
  // 替身只記錄收到的參數，輸出的像素方向從頭到尾沒有人看過：瀏覽器若忽略或做錯
  // `imageOrientation`，這條照樣綠。jsdom 裡沒有解碼器，這件事在這個環境裡驗不到。
  //
  // 它守得住的是另一件小事，而那件事值得守：方向必須在「解碼成 bitmap」那一刻就套用。
  // 先塞進 <img> 再 drawImage 的話，EXIF 在畫進 canvas 之後就沒了——預覽是正的、
  // 上傳後躺著。這個選項被誰順手拿掉時，這裡會轉紅。
  //
  // 使用者看得到的那條 Then 由人類在實機確認一次（見 issue #168 的驗收清單）；
  // 要把它變成自動化的，得先有真實瀏覽器的測試環境——#176。
  it('解碼時要求套用 EXIF 方向（只驗選項有送出，不驗輸出像素）', async () => {
    await resizeAvatar(photo())

    expect(bitmap.options).toEqual([{ imageOrientation: 'from-image' }])
  })

  it('用完的 bitmap 會被釋放', async () => {
    await resizeAvatar(photo())

    expect(bitmap.closed).toBe(1)
  })

  // Given 前端縮圖失敗（瀏覽器不支援 createImageBitmap／canvas，或檔案無法解碼）
  // When  我送出
  // Then  前端改送原檔而不是直接報錯
  it('createImageBitmap 丟例外時回傳原本的 File，不往外拋', async () => {
    bitmap.fail = true
    const original = photo()

    const resized = await resizeAvatar(original)

    expect(resized).toBe(original)
  })

  it('拿不到 2D context 時回傳原本的 File', async () => {
    canvas.hasContext = false
    const original = photo()

    expect(await resizeAvatar(original)).toBe(original)
  })

  it('toBlob 回 null 時回傳原本的 File', async () => {
    canvas.blobNull = true
    const original = photo()

    expect(await resizeAvatar(original)).toBe(original)
  })

  // 瀏覽器不支援 WebP 編碼時，toBlob 會自己退回 image/png。那一份不能頂著 .webp 的
  // 檔名送出去——server 的三道檢查（MIME、副檔名、magic bytes）要三者一致，
  // 掛錯名字會被當成「格式不支援」退件。
  it('編碼器沒有給出 WebP 時回傳原本的 File', async () => {
    canvas.blobType = 'image/png'
    const original = photo()

    expect(await resizeAvatar(original)).toBe(original)
  })
})
