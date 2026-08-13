// 帶 EXIF Orientation 的 JPEG fixture（issue #176）。
//
// ── 為什麼要手工組位元組 ──
//
// issue #176 的第三條 Then 需要「一張真的帶 orientation tag 的 JPEG」。canvas 產不出
// 這種東西：`toBlob` 只吐像素，沒有任何管道寫入 metadata。而 CLAUDE.md 規定相依由人類
// 決定，所以也不能裝一個編碼器。剩下的路只有自己組——好在需求很窄，窄到組得出來。
//
// ── 為什麼組得出來 ──
//
// 這張圖只有兩種顏色，而且是以 8×8 為單位的色塊。JPEG 的每一格若「只有 DC 係數、
// 其餘全零」，解出來就是一格單一顏色——於是整份 entropy-coded data 只需要
// 「DC 差值 + EOB」這一種寫法，用不到 AC 係數，也用不到之字形掃描。
// Huffman 表因此可以是兩張極小的自訂表（見 DC_BITS / AC_BITS），
// 量化表也可以整張都是同一個數字。
//
// ── 這張圖長什麼樣 ──
//
// 存檔的畫面是 1024×512 的橫幅，左上象限深色、其餘淺色。EXIF 標成「順時針轉 90 度」，
// 所以照 EXIF 解碼的瀏覽器會拿到 512×1024 的直幅，而那個深色象限會落在**右上**。
//
//   存檔（1024×512）            轉正後（512×1024）
//   ┌─────┬─────┐              ┌──┬──┐
//   │ 深  │ 淺  │   ──順時針→   │淺│深│
//   ├─────┼─────┤              ├──┼──┤
//   │ 淺  │ 淺  │              │淺│淺│
//   └─────┴─────┘              └──┴──┘
//
// 深色象限的用途是分辨「往哪邊轉」：只看長寬比的話，順時針 90 度與逆時針 90 度
// 給的是同一個答案，而那兩者在畫面上差了 180 度。

/** EXIF Orientation = 1：存檔方向就是顯示方向。第三條 Then 的對照組用 */
export const EXIF_ORIENTATION_NONE = 1

/** EXIF Orientation = 6：顯示時要把存檔的畫面順時針轉 90 度 */
export const EXIF_ORIENTATION_ROTATE_90_CW = 6

/** 存檔（還沒套用 EXIF）的寬。轉正後會變成高 */
export const EXIF_JPEG_WIDTH = 1024

/** 存檔（還沒套用 EXIF）的高。轉正後會變成寬 */
export const EXIF_JPEG_HEIGHT = 512

/** JPEG 的最小單位。這張圖的顏色以它為單位切換，所以取樣時別跨在邊界上 */
export const EXIF_JPEG_BLOCK = 8

/**
 * 量化表的每一格都是這個數字。
 *
 * 只有第 0 格（DC 那一格）真的會被用到——其餘係數全部是零，乘什麼都還是零。
 * 整張填同一個數字省掉了之字形排序這件事：DQT 存的是之字形順序，而順序只影響
 * AC 的畫質，這張圖沒有 AC。
 */
const QUANTIZER = 16

/** 深色格與淺色格的量化後 DC 係數 */
const DARK_DC = -60
const LIGHT_DC = 60

/**
 * 一格解出來的亮度。
 *
 * DC-only 的區塊整格同色：反量化後的 DC 是 `dc * QUANTIZER`，IDCT 的 DC 項再除以 8，
 * 最後加回 level shift 的 128。QUANTIZER 是 16，所以就是 `128 + dc * 2`。
 */
const luma = (dc: number) => 128 + (dc * QUANTIZER) / 8

/** 深色格解出來的亮度（8，接近全黑） */
export const EXIF_JPEG_DARK = luma(DARK_DC)

/** 淺色格解出來的亮度（248，接近全白） */
export const EXIF_JPEG_LIGHT = luma(LIGHT_DC)

/**
 * 一段標記：`0xFF`、標記碼、兩個 byte 的長度（含自己），然後才是內容。
 */
function segment(code: number, payload: number[]): number[] {
  const length = payload.length + 2

  return [0xFF, code, length >> 8, length & 0xFF, ...payload]
}

/** APP1：`Exif\0\0` + 一份只有 Orientation 這一筆的 little-endian TIFF */
function app1(orientation: number): number[] {
  return [
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"

    0x49, 0x49, // "II"：接下來都是 little endian
    0x2A, 0x00, // TIFF 的 magic number（42）
    0x08, 0x00, 0x00, 0x00, // IFD0 從 TIFF header 起算的位移

    0x01, 0x00, // IFD0 有一筆
    0x12, 0x01, // tag 0x0112（Orientation）
    0x03, 0x00, // 型別 SHORT
    0x01, 0x00, 0x00, 0x00, // 一個值
    orientation & 0xFF, (orientation >> 8) & 0xFF, 0x00, 0x00,

    0x00, 0x00, 0x00, 0x00, // 沒有下一個 IFD
  ]
}

/** DQT：8-bit、table 0，整張同一個數字 */
const dqt = (): number[] => [0x00, ...Array.from({ length: 64 }, () => QUANTIZER)]

/** SOF0：baseline、8-bit、單一灰階分量、不做次取樣 */
const sof0 = (): number[] => [
  0x08,
  EXIF_JPEG_HEIGHT >> 8, EXIF_JPEG_HEIGHT & 0xFF,
  EXIF_JPEG_WIDTH >> 8, EXIF_JPEG_WIDTH & 0xFF,
  0x01, // 一個分量
  0x01, // 分量編號
  0x11, // 水平 1、垂直 1
  0x00, // 用量化表 0
]

/**
 * DHT 的長度分佈：第 n 項是「長度 n+1 的碼有幾個」。
 *
 * ⚠ **碼空間不可以用滿**。T.81 Annex C 的產碼流程要求「最長長度的全 1 碼」保持未指派，
 * libjpeg（Chromium 用的就是它的分支）在 `jpeg_make_d_derived_tbl` 逐長度檢查
 * `code < 2^si`，不合就整份檔案退成 `JERR_BAD_HUFF_TABLE`。
 * 表面症狀是 `createImageBitmap` 丟 `InvalidStateError: The source image could not be
 * decoded.`——看起來像檔案壞掉，其實只有 Huffman 表多給了一個碼。這裡踩過一次。
 *
 * 所以 DC 這張是「類別 0～6 各一個 3 bit 的碼（000～110，留下 111 不用），
 * 類別 7 一個 4 bit 的碼（1110）」。類別 7 涵蓋到 ±127，
 * 而這張圖最大的 DC 差值是 120，夠用。
 */
const DC_BITS = [0, 0, 7, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

/**
 * AC 只需要 EOB 一種符號，所以整張表就一個 1 bit 的碼（0）。
 *
 * 這是一張「不完整」的表——碼 1 沒有對應的符號——而不完整是允許的，
 * 被禁的是上面那種「用滿」。反過來開成兩個 1 bit 的碼才會被退件。
 */
const AC_BITS = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

const dhtDc = (): number[] => [0x00, ...DC_BITS, 0, 1, 2, 3, 4, 5, 6, 7]
const dhtAc = (): number[] => [0x10, ...AC_BITS, 0x00]

/** 類別 → 它的 Huffman 碼與長度。對應 DC_BITS 那張表的正規化結果 */
const dcCode = (category: number): [code: number, length: number] =>
  category < 7 ? [category, 3] : [0b1110, 4]

/** SOS：唯一那個分量、DC 用表 0、AC 用表 0，baseline 的頻譜參數 */
const sos = (): number[] => [0x01, 0x01, 0x00, 0x00, 0x3F, 0x00]

/**
 * 逐 bit 寫出 entropy-coded data，並在 0xFF 之後補一個 0x00。
 *
 * 補那個 0x00 不是可選的：解碼器看到 0xFF 就會開始找標記，沒有填充的話，
 * 資料裡湊巧出現的 0xFF 會被當成 SOS 結束。
 */
class BitWriter {
  private readonly bytes: number[] = []
  private current = 0
  private filled = 0

  write(value: number, length: number): void {
    for (let index = length - 1; index >= 0; index -= 1) {
      this.current = (this.current << 1) | ((value >> index) & 1)
      this.filled += 1

      if (this.filled === 8) {
        this.bytes.push(this.current)
        if (this.current === 0xFF) this.bytes.push(0x00)
        this.current = 0
        this.filled = 0
      }
    }
  }

  /** 用 1 補滿最後一個 byte（標準指定的填充值），回傳寫好的位元組 */
  finish(): number[] {
    while (this.filled !== 0) this.write(1, 1)

    return this.bytes
  }
}

/** 這一格屬於左上象限嗎 */
const isDark = (blockX: number, blockY: number, across: number, down: number) =>
  blockX < across / 2 && blockY < down / 2

/** 每一格寫成「DC 差值 + EOB」，順序是由左到右、由上到下 */
function entropy(): number[] {
  const across = Math.ceil(EXIF_JPEG_WIDTH / EXIF_JPEG_BLOCK)
  const down = Math.ceil(EXIF_JPEG_HEIGHT / EXIF_JPEG_BLOCK)
  const writer = new BitWriter()
  let previous = 0

  for (let blockY = 0; blockY < down; blockY += 1) {
    for (let blockX = 0; blockX < across; blockX += 1) {
      const dc = isDark(blockX, blockY, across, down) ? DARK_DC : LIGHT_DC
      const diff = dc - previous
      previous = dc

      // 類別＝表示這個差值需要幾個 bit。差值是 0 就只寫類別，不接任何附加位元
      const category = diff === 0 ? 0 : 32 - Math.clz32(Math.abs(diff))

      writer.write(...dcCode(category))

      if (category > 0) {
        // 負數走的是「補數再減一」那一套：解碼端靠最高位是 0 認出它是負的
        writer.write(diff > 0 ? diff : diff + (1 << category) - 1, category)
      }

      writer.write(0, 1) // EOB：這一格沒有 AC 係數
    }
  }

  return writer.finish()
}

const scan = entropy()

/**
 * 一張 1024×512 的灰階 JPEG，EXIF 標著指定的 Orientation。
 *
 * 像素內容與 orientation 無關——換句話說，`EXIF_ORIENTATION_NONE` 那一份與
 * `EXIF_ORIENTATION_ROTATE_90_CW` 那一份只差在 EXIF 裡的那一個 byte。
 * 兩份的解碼結果若相同，就代表這個瀏覽器根本沒有讀 EXIF。
 */
// 回傳型別寫成 `Uint8Array<ArrayBuffer>` 而不是 `Uint8Array`：後者的 buffer 是
// `ArrayBufferLike`（可能是 SharedArrayBuffer），而 `new File([...])` 的 BlobPart
// 只收 `ArrayBuffer` 那一種。少了這個標註，瀏覽器那一側的 `new File([exifJpeg(...)])`
// 就會是型別錯誤——而 `tests/` 不在 `nuxt typecheck` 的範圍內，那個錯誤不會有人告訴你
export function exifJpeg({ orientation }: { orientation: number }): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0xFF, 0xD8, // SOI
    ...segment(0xE1, app1(orientation)),
    ...segment(0xDB, dqt()),
    ...segment(0xC0, sof0()),
    ...segment(0xC4, dhtDc()),
    ...segment(0xC4, dhtAc()),
    ...segment(0xDA, sos()),
    ...scan,
    0xFF, 0xD9, // EOI
  ])
}
