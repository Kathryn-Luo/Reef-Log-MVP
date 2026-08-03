import type { Locator } from '@playwright/test'

// CSS 顏色字串 → alpha。
//
// 起因（issue #97）：Tailwind v4 的 `bg-black/60` 是用 `color-mix()` 在 oklab 色彩空間算的，
// `getComputedStyle().backgroundColor` 回傳的因此是 `oklab(0 0 0 / 0.6)` 而不是 `rgba(...)`。
// 把斷言寫成「字串長得像 rgba()」的測試會在遮罩完全正常的情況下紅掉。
//
// 這裡的分工是刻意的：
//   `backgroundAlpha` 讓瀏覽器自己換算（canvas 吃得下任何 CSS 顏色，吐回來的一律是
//   `#rrggbb` 或 `rgba()`），`alphaOf` 則是不碰瀏覽器的純函式，unit 測試驗得到。
//   瀏覽器換不動時退回原字串，仍然由 `alphaOf` 解析——所以支援哪些顏色函式這件事，
//   不是靠在測試裡逐一列舉格式撐起來的。

/**
 * 從 CSS 顏色字串解析出 alpha（0–1）。
 *
 * 認的是 CSS 放 alpha 的兩個位置，與函式叫什麼名字無關：
 *   - 現代語法：分量後面的 `/ alpha`（`rgb()` / `oklab()` / `oklch()` / `color()`…）
 *   - 舊語法：四個逗號分量的最後一個（`rgba()` / `hsla()`）
 * 兩者都沒有就是不透明。
 *
 * @throws 解析不出來時丟出帶著原字串的錯誤——沉默地猜一個值會讓上層斷言假綠。
 */
export function alphaOf(colour: string): number {
  const value = colour.trim()

  if (value === 'transparent') return 0

  // #rgba / #rrggbbaa。其餘的 hex 與具名顏色沒有 alpha 分量，落到最後的 1。
  const hex = /^#(?:([\da-f])([\da-f])([\da-f])([\da-f])|[\da-f]{6}([\da-f]{2}))$/i.exec(value)
  if (hex) {
    const digits = hex[5] ?? `${hex[4]}${hex[4]}`
    return Number.parseInt(digits, 16) / 255
  }

  const args = /^[a-z-]+\(([^()]*)\)$/i.exec(value)?.[1]
  if (args === undefined) {
    // 巢狀的顏色函式（例如沒被瀏覽器換算掉的 `color-mix()`）不猜：裡層也會有 `/`，
    // 隨便挑一個解析出來的數字會是錯的。
    if (value.includes('(')) throw new Error(`無法從「${colour}」解析出 alpha`)
    return 1
  }

  const slash = args.indexOf('/')
  if (slash !== -1) return alphaFrom(args.slice(slash + 1), colour)

  const parts = args.split(',')
  if (parts.length === 4) return alphaFrom(parts[3]!, colour)

  return 1
}

/** `0.6` / `.6` / `60%` → 0.6 */
function alphaFrom(token: string, colour: string): number {
  const text = token.trim()
  const percentage = text.endsWith('%')
  const number = Number(percentage ? text.slice(0, -1) : text)

  if (text === '' || !Number.isFinite(number)) throw new Error(`無法從「${colour}」解析出 alpha`)

  return percentage ? number / 100 : number
}

/**
 * 元素的 computed background-color 的 alpha。
 *
 * 先讓瀏覽器把顏色正規化：canvas 的 `fillStyle` 用的是 CSS 顏色解析器，吃得下 `oklab()`、
 * `color-mix()` 這些寫法，讀回來的一律是 `#rrggbb`（不透明）或 `rgba()`（半透明）。
 * 吃不下時 assignment 會被忽略、`fillStyle` 原封不動留在起點值，那時退回原字串。
 */
export async function backgroundAlpha(locator: Locator): Promise<number> {
  const colour = await locator.evaluate((element) => {
    const computed = getComputedStyle(element).backgroundColor
    const context = document.createElement('canvas').getContext('2d')

    if (!context) return computed

    context.fillStyle = '#000000'
    context.fillStyle = computed
    const normalised = context.fillStyle

    // 起點值代表兩件事之一：瀏覽器解析不了，或它本來就是不透明黑。兩種情況下原字串
    // 都解析得出正確的 alpha，退回去即可。
    return typeof normalised === 'string' && normalised !== '#000000' ? normalised : computed
  })

  return alphaOf(colour)
}
