// @vitest-environment node
// 純位元組組裝與解析，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it } from 'vitest'
import {
  EXIF_JPEG_BLOCK,
  EXIF_JPEG_DARK,
  EXIF_JPEG_HEIGHT,
  EXIF_JPEG_LIGHT,
  EXIF_JPEG_WIDTH,
  EXIF_ORIENTATION_NONE,
  EXIF_ORIENTATION_ROTATE_90_CW,
  exifJpeg,
} from '../../browser/support/exifJpeg'

// issue #176：`resizeAvatar` 的真實瀏覽器覆蓋，這一支守的是那組測試要用的 fixture。
//
// ── 為什麼 fixture 要自己組位元組 ──
//
// issue 的第三條 Then 要「一張真的帶 EXIF Orientation tag 的 JPEG」。canvas 產不出
// EXIF（`toBlob` 只吐像素，沒有 metadata），而本 repo 不新增相依（CLAUDE.md），
// 所以沒有現成的編碼器可用。剩下的路只有一條：手工組一份 baseline JPEG。
//
// ── 這支測試證明了什麼、沒證明什麼 ──
//
// 證明的是「這份 fixture 真的是我們以為的那張圖」：它是合法的 JPEG 骨架、EXIF 裡真的
// 有 Orientation tag、**存檔的畫面是橫的**（所以忽略 EXIF 的解碼器會給出橫的），而且
// 左上象限真的是深色（所以轉了幾度、往哪邊轉，看得出來）。
//
// 沒證明的是「瀏覽器讀不讀得開、會不會照 EXIF 轉」——那要真的解碼器，只有
// `tests/browser/resize-avatar.browser.ts` 驗得到。這一支守的是它的前置條件：
// fixture 壞掉時要紅在這裡，而不是紅成一條看不懂的瀏覽器測試。

/** 一段 JPEG 標記：`marker` 是 0xFFxx 的後半個 byte，`payload` 不含長度那兩 byte */
interface Segment {
  marker: number
  offset: number
  payload: Uint8Array
}

/**
 * 走過 SOS 之前的每一段標記。
 *
 * 刻意自己走一遍而不是信任 fixture 自己報的位移：這裡要驗的正是「段落長度寫對了」，
 * 拿 fixture 的說法來驗 fixture 等於沒驗——長度寫錯的話這個走訪自己就會迷路。
 */
function segments(bytes: Uint8Array): Segment[] {
  const found: Segment[] = []
  let offset = 2 // 跳過 SOI

  while (offset + 4 <= bytes.length) {
    expect(bytes[offset], `位移 ${offset} 不是標記的開頭`).toBe(0xFF)

    const marker = bytes[offset + 1]!
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!

    found.push({ marker, offset, payload: bytes.subarray(offset + 4, offset + 2 + length) })

    // SOS 之後接的是 entropy-coded data，沒有長度可以跳，走訪到此為止
    if (marker === 0xDA) break

    offset += 2 + length
  }

  return found
}

const segmentOf = (bytes: Uint8Array, marker: number): Segment => {
  const segment = segments(bytes).find(candidate => candidate.marker === marker)

  expect(segment, `找不到標記 0xFF${marker.toString(16).toUpperCase()}`).toBeDefined()

  return segment!
}

const u16be = (bytes: Uint8Array, at: number) => (bytes[at]! << 8) | bytes[at + 1]!
const u16le = (bytes: Uint8Array, at: number) => bytes[at]! | (bytes[at + 1]! << 8)

/**
 * 從 APP1 段落裡讀出 EXIF 的 Orientation。
 *
 * 從 `Exif\0\0` 一路解到 IFD0 的那一筆，而不是「檔案裡有沒有 0x0112 這兩個 byte」——
 * 後者在任何一份四 KB 的二進位檔裡都幾乎必然成立，等於恆真。
 */
function exifOrientation(bytes: Uint8Array): number {
  const app1 = segmentOf(bytes, 0xE1).payload

  expect(new TextDecoder().decode(app1.subarray(0, 6))).toBe('Exif\0\0')

  const tiff = app1.subarray(6)

  expect(new TextDecoder().decode(tiff.subarray(0, 2)), 'TIFF header 要宣告 little endian').toBe('II')
  expect(u16le(tiff, 2), 'TIFF 的 magic number 是 42').toBe(42)

  const ifd0 = tiff[4]! | (tiff[5]! << 8) | (tiff[6]! << 16) | (tiff[7]! << 24)
  const count = u16le(tiff, ifd0)

  for (let index = 0; index < count; index += 1) {
    const entry = ifd0 + 2 + index * 12

    if (u16le(tiff, entry) !== 0x0112) continue

    expect(u16le(tiff, entry + 2), 'Orientation 的型別是 SHORT（3）').toBe(3)

    return u16le(tiff, entry + 8)
  }

  throw new Error('IFD0 裡沒有 Orientation（0x0112）')
}

/** SOF0 宣告的「存檔尺寸」——也就是還沒套用 EXIF 之前的那一個 */
function storedSize(bytes: Uint8Array): { width: number, height: number } {
  const sof0 = segmentOf(bytes, 0xC0).payload

  return { height: u16be(sof0, 1), width: u16be(sof0, 3) }
}

/**
 * 把 entropy-coded data 的 DC 係數解回每一格的亮度。
 *
 * 這是一份**只認得這份 fixture 的**極簡解碼器：它寫死了 fixture 自己選的兩張 Huffman
 * 表（DC 八個 3 bit 的碼、AC 兩個 1 bit 的碼），也假設每一格只有 DC 後面直接接 EOB。
 * 它的作用不是通用解碼，而是把「編碼那一側算出來的東西」原路讀回來——象限算錯、
 * 負數的 diff 編碼寫反、byte stuffing 漏掉，都會在這裡現形。
 */
function blockLuma(bytes: Uint8Array): number[] {
  const sos = segmentOf(bytes, 0xDA)
  const start = sos.offset + 2 + u16be(bytes, sos.offset + 2)

  // 去掉 byte stuffing：entropy data 裡的 0xFF 後面一定跟著一個填充的 0x00
  const scan: number[] = []
  for (let at = start; at < bytes.length; at += 1) {
    const byte = bytes[at]!

    if (byte === 0xFF) {
      const next = bytes[at + 1]!

      if (next === 0xD9) break // EOI

      expect(next, `位移 ${at} 的 0xFF 後面沒有填充 0x00`).toBe(0)
      scan.push(byte)
      at += 1
      continue
    }

    scan.push(byte)
  }

  let cursor = 0
  const readBits = (count: number) => {
    let value = 0
    for (let taken = 0; taken < count; taken += 1) {
      const byte = scan[cursor >> 3] ?? 0
      value = (value << 1) | ((byte >> (7 - (cursor & 7))) & 1)
      cursor += 1
    }
    return value
  }

  const luma: number[] = []
  const blocks = Math.ceil(EXIF_JPEG_WIDTH / EXIF_JPEG_BLOCK) * Math.ceil(EXIF_JPEG_HEIGHT / EXIF_JPEG_BLOCK)
  let dc = 0

  for (let block = 0; block < blocks; block += 1) {
    // 類別 0～6 是 3 bit 的 000～110；111 是類別 7 那個 4 bit 碼（1110）的前綴
    let category = readBits(3)

    if (category === 7) {
      expect(readBits(1), `第 ${block} 格的 111 後面不是類別 7 的碼`).toBe(0)
      category = 7
    }

    if (category > 0) {
      const raw = readBits(category)
      // 正負的判斷看最高位：0 代表這是負的那一半，要減回去
      dc += raw >= 1 << (category - 1) ? raw : raw - (1 << category) + 1
    }

    expect(readBits(1), `第 ${block} 格的 AC 不是 EOB`).toBe(0)

    // DC-only 的區塊：反量化後整格都是同一個值。量化表全部是 16，
    // IDCT 的 DC 項因此是 dc * 16 / 8 = dc * 2，再加回 level shift 的 128
    luma.push(128 + dc * 2)
  }

  return luma
}

/** 第 (x, y) 格的亮度 */
function lumaAt(luma: number[], blockX: number, blockY: number): number {
  return luma[blockY * Math.ceil(EXIF_JPEG_WIDTH / EXIF_JPEG_BLOCK) + blockX]!
}

describe('EXIF fixture 是一份合法的 baseline JPEG', () => {
  const bytes = exifJpeg({ orientation: EXIF_ORIENTATION_ROTATE_90_CW })

  it('以 SOI 開頭、以 EOI 結尾', () => {
    expect([bytes[0], bytes[1]]).toEqual([0xFF, 0xD8])
    expect([bytes.at(-2), bytes.at(-1)]).toEqual([0xFF, 0xD9])
  })

  // 段落長度寫錯的話，segments() 自己就會走到不是 0xFF 的地方而紅
  it('段落順序是 APP1 → DQT → SOF0 → DHT ×2 → SOS', () => {
    expect(segments(bytes).map(segment => segment.marker)).toEqual([
      0xE1, // APP1（EXIF）
      0xDB, // DQT
      0xC0, // SOF0（baseline）
      0xC4, // DHT（DC）
      0xC4, // DHT（AC）
      0xDA, // SOS
    ])
  })

  it('量化表與 Huffman 表都宣告成 8-bit、table 0', () => {
    expect(segmentOf(bytes, 0xDB).payload[0], 'DQT 的 Pq/Tq').toBe(0x00)

    const huffman = segments(bytes).filter(segment => segment.marker === 0xC4)

    expect(huffman.map(segment => segment.payload[0])).toEqual([0x00, 0x10])
  })

  // issue 說「幾 KB 即可」。這條同時是「沒有人不小心把它做成一張全尺寸照片」的護欄
  it('只有幾 KB', () => {
    expect(bytes.byteLength).toBeGreaterThan(0)
    expect(bytes.byteLength).toBeLessThan(16 * 1024)
  })
})

// Given 一張帶 EXIF Orientation=6（順時針 90 度）的 JPEG
//
// 這一條是第三條 Then 的前置狀態。fixture 沒有真的帶上那個 tag 的話，
// 瀏覽器那一側驗到的就只是「一張橫的圖沒有被轉」——而且是綠的。
describe('EXIF 裡真的有 Orientation tag', () => {
  it('要求順時針 90 度時，IFD0 的 Orientation 是 6', () => {
    expect(exifOrientation(exifJpeg({ orientation: EXIF_ORIENTATION_ROTATE_90_CW }))).toBe(6)
  })

  // 對照組：瀏覽器那一側要拿它來確認「差別真的來自 EXIF」，而不是來自別的東西
  it('要求不轉時是 1，其餘位元組與轉 90 度那一份一樣長', () => {
    const upright = exifJpeg({ orientation: EXIF_ORIENTATION_NONE })

    expect(exifOrientation(upright)).toBe(1)
    expect(upright.byteLength).toBe(exifJpeg({ orientation: EXIF_ORIENTATION_ROTATE_90_CW }).byteLength)
  })
})

// 存檔的畫面必須是「橫的」。這是整張 fixture 的支點：
// 忽略 EXIF 的解碼器會給出 1024×512（躺著的那一版），照 EXIF 轉的會給出 512×1024。
// 存檔尺寸若是正方形或直式，第三條 Then 就分不出這兩者。
describe('存檔的畫面是橫的，轉正之後才是直的', () => {
  it('SOF0 宣告的存檔尺寸是 1024×512', () => {
    expect(storedSize(exifJpeg({ orientation: EXIF_ORIENTATION_ROTATE_90_CW }))).toEqual({
      width: EXIF_JPEG_WIDTH,
      height: EXIF_JPEG_HEIGHT,
    })
  })

  it('存檔是橫的，長邊超過 512——轉正後仍然要縮', () => {
    expect(EXIF_JPEG_WIDTH).toBeGreaterThan(EXIF_JPEG_HEIGHT)
    expect(Math.max(EXIF_JPEG_WIDTH, EXIF_JPEG_HEIGHT)).toBeGreaterThan(512)
  })
})

// 只驗長寬比的話，順時針 90 度與逆時針 90 度是同一個答案——而那兩者在畫面上
// 差了 180 度。深色象限就是用來分辨方向的那個記號。
describe('左上象限是深色，其餘是淺色', () => {
  const luma = blockLuma(exifJpeg({ orientation: EXIF_ORIENTATION_ROTATE_90_CW }))

  const across = Math.ceil(EXIF_JPEG_WIDTH / EXIF_JPEG_BLOCK)
  const down = Math.ceil(EXIF_JPEG_HEIGHT / EXIF_JPEG_BLOCK)

  it('每一格都解得回一個亮度', () => {
    expect(luma).toHaveLength(across * down)
  })

  it('左上角是深的', () => {
    expect(lumaAt(luma, 0, 0)).toBe(EXIF_JPEG_DARK)
    expect(lumaAt(luma, across / 2 - 1, down / 2 - 1)).toBe(EXIF_JPEG_DARK)
  })

  it('另外三個象限是淺的', () => {
    expect(lumaAt(luma, across - 1, 0)).toBe(EXIF_JPEG_LIGHT)
    expect(lumaAt(luma, 0, down - 1)).toBe(EXIF_JPEG_LIGHT)
    expect(lumaAt(luma, across - 1, down - 1)).toBe(EXIF_JPEG_LIGHT)
  })

  it('深與淺分得夠開，WebP 壓過一輪還認得出來', () => {
    expect(EXIF_JPEG_LIGHT - EXIF_JPEG_DARK).toBeGreaterThan(160)
  })
})
