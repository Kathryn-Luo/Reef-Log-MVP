import { expect, test } from 'vitest'
import {
  AVATAR_MAX_EDGE,
  AVATAR_OUTPUT_TYPE,
  resizeAvatar,
} from '../../app/utils/avatarImage'
import {
  EXIF_ORIENTATION_NONE,
  EXIF_ORIENTATION_ROTATE_90_CW,
  exifJpeg,
} from './support/exifJpeg'

// issue #176：在**真的瀏覽器**裡驗 `resizeAvatar`。
//
// ── 為什麼需要這一支 ──
//
// `resizeAvatar` 整段建立在三個只有真實瀏覽器才有的 API 上：
// `createImageBitmap(file, { imageOrientation: 'from-image' })`、`drawImage`、
// `toBlob('image/webp', 0.8)`。jsdom / happy-dom 三個都沒有，所以
// `tests/unit/app/resize-avatar.test.ts` 只能把它們換成替身——那驗到的是
// 「我呼叫了替身、替身回了我安排好的東西」，不是「縮圖真的縮了」。
//
// 這一支反過來：一個替身都不用，量的是真的解回來的像素。
//
// ── 為什麼檔名不是 .test.ts ──
//
// 這支跑不進 `pnpm test`（那是 happy-dom，沒有 canvas），要 `@vitest/browser` 才跑得動，
// 而那是新的開發相依——CLAUDE.md 規定相依由人類決定。`.browser.ts` 這個檔名讓 vitest
// 的預設收檔規則自然收不到它，不必去動 `vitest.config.ts` 的 `exclude` 白名單
// （那份白名單是 #32 的防線）。怎麼啟用寫在 `docs/BROWSER_TESTS.md`。
//
// 這一側沒跑到的期間，「修法有沒有走偏」由
// `tests/unit/browser/resize-avatar-browser-spec.test.ts` 比對本檔的原始碼本文守住。

/** 一張真的由瀏覽器編碼出來的 PNG。內容是純色，尺寸才是這裡的重點 */
async function pngFile(width: number, height: number): Promise<File> {
  const canvas = document.createElement('canvas')

  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')!

  // 填滿顏色：全透明的畫布會被編碼器壓成幾乎沒有內容的一份，量不到縮圖的效果
  context.fillStyle = '#0ea5e9'
  context.fillRect(0, 0, width, height)

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))

  expect(blob, '這個瀏覽器連 PNG 都編不出來').not.toBeNull()

  return new File([blob!], 'source.png', { type: 'image/png' })
}

/** 把檔案真的解回點陣圖，量它的尺寸——不是從呼叫參數推回來的 */
async function sizeOf(file: File): Promise<{ width: number, height: number }> {
  const bitmap = await createImageBitmap(file)
  const size = { width: bitmap.width, height: bitmap.height }

  bitmap.close()

  return size
}

/** 四個象限中心各取一小塊，回傳平均亮度（灰階，取紅色通道即可） */
async function quadrantLuma(file: File) {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')

  canvas.width = bitmap.width
  canvas.height = bitmap.height

  const context = canvas.getContext('2d')!

  context.drawImage(bitmap, 0, 0)
  bitmap.close()

  /** 取樣一小塊再平均，避開單一像素被壓縮雜訊帶偏 */
  const patch = (fractionX: number, fractionY: number) => {
    const size = 8
    const x = Math.round(canvas.width * fractionX - size / 2)
    const y = Math.round(canvas.height * fractionY - size / 2)
    const { data } = context.getImageData(x, y, size, size)

    let total = 0
    for (let at = 0; at < data.length; at += 4) total += data[at]!

    return total / (data.length / 4)
  }

  return {
    topLeft: patch(0.25, 0.25),
    topRight: patch(0.75, 0.25),
    bottomLeft: patch(0.25, 0.75),
    bottomRight: patch(0.75, 0.75),
  }
}

// Given 一張 1024×768 的 PNG
// When  呼叫 resizeAvatar
// Then  輸出的長邊是 512、維持 4:3、型別是 image/webp
test('長邊縮到 512 px，維持 4:3，輸出是 image/webp', async () => {
  const source = await pngFile(1024, 768)

  const { file, outcome } = await resizeAvatar(source)

  expect(outcome).toBe('resized')
  // 4:3 的 1024×768 → 512×384。長邊、比例兩件事在同一個斷言裡
  expect(await sizeOf(file)).toEqual({ width: AVATAR_MAX_EDGE, height: 384 })
  // 驗的是輸出檔案自己的 type：`toBlob` 編不出 WebP 時會安靜地回一份 PNG，
  // 「我傳了 image/webp 進去」證明不了「出來的是 WebP」
  expect(file.type).toBe(AVATAR_OUTPUT_TYPE)
  expect(file.size).toBeGreaterThan(0)
})

// Given 一張 200×150 的 PNG
// When  呼叫 resizeAvatar
// Then  尺寸不變（只縮不放）
test('200×150 的圖維持原尺寸，不放大', async () => {
  const source = await pngFile(200, 150)

  const { file, outcome } = await resizeAvatar(source)

  expect(outcome).toBe('resized')
  expect(await sizeOf(file)).toEqual({ width: 200, height: 150 })
  expect(file.type).toBe(AVATAR_OUTPUT_TYPE)
})

// Given 一張帶 EXIF Orientation=6（順時針 90 度）的 JPEG
// When  呼叫 resizeAvatar
// Then  輸出的長寬比與肉眼看到的方向一致，不是躺著的那一版
//
// fixture 存檔是 1024×512 的橫幅、左上象限深色（見 support/exifJpeg.ts）。
// 照 EXIF 轉正之後是 512×1024 的直幅，深色象限落在右上；縮到長邊 512 就是 256×512。
// 忽略 EXIF 的話會是 512×256——那正是「預覽是正的、上傳後躺著」的形態。
//
// ⚠ 這一條不是「`imageOrientation: 'from-image'` 有送出」的證明。實測 Chromium 151
// 不帶那個選項解出來的尺寸一模一樣——規格後來把它的預設值從 'none' 改成了
// 'from-image'，所以新的瀏覽器送不送都一樣。那個選項仍然得留著（舊 WebKit 的預設
// 不轉），而「它有沒有被順手拿掉」由 tests/unit/app/resize-avatar.test.ts 顧。
//
// 這一條顧的是使用者真正看得到的那件事：整條管線走完之後方向沒有掉。那才是 mock
// 底下永遠測不出來的部分——換成先塞進 <img> 再 drawImage 之類的寫法，這裡會紅。
test('EXIF Orientation=6 的照片轉正之後才縮，深色角落落在右上', async () => {
  const rotated = new File(
    [exifJpeg({ orientation: EXIF_ORIENTATION_ROTATE_90_CW })],
    'IMG_0001.JPG',
    { type: 'image/jpeg' },
  )

  const { file, outcome } = await resizeAvatar(rotated)

  expect(outcome).toBe('resized')
  expect(await sizeOf(file)).toEqual({ width: 256, height: 512 })

  // 只比長寬比的話，順時針 90 度與逆時針 90 度是同一個答案，而那兩者差了 180 度。
  // 深色象限在哪一角，才分得出轉的方向對不對
  const { topLeft, topRight, bottomLeft, bottomRight } = await quadrantLuma(file)

  expect(topRight, '深色象限應該轉到右上').toBeLessThan(96)
  expect(topLeft, '左上應該是淺的').toBeGreaterThan(160)
  expect(bottomLeft, '左下應該是淺的').toBeGreaterThan(160)
  expect(bottomRight, '右下應該是淺的').toBeGreaterThan(160)

  // 對照組：像素完全一樣、只有 EXIF 那一個 byte 不同的那一份必須是橫的。
  // 少了它，「瀏覽器根本沒讀 EXIF」與「讀了而且轉對了」分不出來
  const upright = new File(
    [exifJpeg({ orientation: EXIF_ORIENTATION_NONE })],
    'IMG_0002.JPG',
    { type: 'image/jpeg' },
  )

  const control = await resizeAvatar(upright)

  expect(control.outcome).toBe('resized')
  expect(await sizeOf(control.file)).toEqual({ width: 512, height: 256 })
})
