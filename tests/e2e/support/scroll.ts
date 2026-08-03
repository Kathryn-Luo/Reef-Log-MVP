import type { Page } from '@playwright/test'

// 首頁捲動的共用 helper。
//
// 這一版是原封不動從 `home.spec.ts` 搬過來的「現況」——連同 issue #96 要修的兩個 bug。
// 先搬再修，紅燈才會是那兩個 bug 本身，而不是「找不到模組」。

/** 首頁資料到齊的標記 */
export const HOME_CONTENT = '[data-testid="home-sticky-header"]'

/** 捲到指定位置（超過頁面高度就捲到底），再等捲動位置定下來才回傳 */
export async function scrollTo(page: Page, offset: number) {
  const target = await page.evaluate((top) => {
    const max = document.documentElement.scrollHeight - window.innerHeight
    const clamped = Math.max(0, Math.min(top, max))

    window.scrollTo({ top: clamped, behavior: 'instant' })

    return clamped
  }, offset)

  await page.waitForFunction(top => Math.abs(window.scrollY - top) < 2, target)
}

/** 捲到足以觸發頁首收合的位置——現況就是 spec 裡那個寫死的 1200 */
export async function scrollPastCollapse(page: Page) {
  return scrollTo(page, 1200)
}
