import type { Page } from '@playwright/test'
import { HEADER_COLLAPSE_AT } from '../../../shared/utils/stickyHeader'

// 首頁捲動的共用 helper（issue #96）。
//
// 首頁向下捲會讓 sticky 頁首收合，固定區從約 236px 縮到約 92px，**文件跟著變矮約 108px**。
// 這件事讓「捲動」在這一頁不是一個瞬間完成的動作：
//
//   ① 送出捲動之後，瀏覽器還會把 scrollY 夾回收合後那個比較小的最大值。
//      任何在捲動「之前」算出來的目標值，都與最後的落點對不起來——原本的 helper
//      拿那個值去 `waitForFunction`，於是必然等到逾時。判準因此改成「捲動位置與文件
//      高度都不再變動」，收合造成的回夾是正常結果，不是失敗。
//   ② SPA（#84）下 `page.goto('/')` 回來時資料還在路上，此時 `scrollHeight` 與 viewport
//      同高、頁面根本捲不動，「捲到 0」會立刻成立——看起來成功，其實什麼都沒捲。
//      所以捲之前一律先等首頁內容出現。
//
// 這兩件事的邏輯由 `tests/unit/e2e/home-scroll-helper.test.ts` 以假瀏覽器覆蓋。

/** 首頁資料到齊的標記：sticky 頁首要有缸的資料才渲染得出來 */
export const HOME_CONTENT = '[data-testid="home-sticky-header"]'

/** 捲動位置與文件高度連續這麼多幀沒有變動，才算「定下來了」 */
const STABLE_FRAMES = 4

/** 等它定下來的上限；60fps 下約 3 秒，遠寬於 200ms 的收合過場 */
const SETTLE_FRAMES = 180

/** 量測捲動位置的容差：ease-out 的尾巴會落在次像素上，差這麼多不算還在動 */
const SETTLED_WITHIN = 0.5

/** 等首頁的內容出現——在那之前 `scrollHeight` 不具意義 */
export async function waitForHomeContent(page: Page): Promise<void> {
  await page.locator(HOME_CONTENT).waitFor()
}

/**
 * 等首頁內容出現，而且頁面真的捲得動。
 *
 * @param minimum 至少要有這麼多可捲空間，預設是收合門檻——捲不到門檻的頁面，
 *   任何「捲下去會收合」的斷言都只會拿到一個沒捲動的畫面。
 */
export async function waitForScrollableHome(
  page: Page,
  minimum: number = HEADER_COLLAPSE_AT,
): Promise<void> {
  await waitForHomeContent(page)

  await page.waitForFunction(
    min => document.documentElement.scrollHeight - window.innerHeight >= min,
    minimum,
  )
}

/** 捲到 top，然後逐幀等捲動位置與文件高度都停止變動，回傳實際落點 */
async function settle(page: Page, top: number): Promise<number> {
  return page.evaluate(async ({ target, stableFrames, maxFrames, within }) => {
    window.scrollTo({ top: target, behavior: 'instant' })

    const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

    let previousTop = Number.NaN
    let previousHeight = Number.NaN
    let stable = 0

    for (let frame = 0; frame < maxFrames && stable < stableFrames; frame++) {
      await nextFrame()

      const height = document.documentElement.scrollHeight

      // 收合播放期間文件每幀變矮、scrollY 每幀被夾小一點，兩者同時定下來才是播完了
      if (Math.abs(window.scrollY - previousTop) < within && height === previousHeight) {
        stable++
      }
      else {
        stable = 0
        previousTop = window.scrollY
        previousHeight = height
      }
    }

    return window.scrollY
  }, { target: top, stableFrames: STABLE_FRAMES, maxFrames: SETTLE_FRAMES, within: SETTLED_WITHIN })
}

/**
 * 捲到指定位置（超過可捲空間就捲到底），等捲動位置定下來才回傳實際落點。
 *
 * 回傳的是「真的停在哪」而不是呼叫時給的目標：收合會把落點往回夾，兩者本來就會不同。
 */
export async function scrollTo(page: Page, offset: number): Promise<number> {
  await waitForHomeContent(page)

  return settle(page, offset)
}

/**
 * 捲到「夠遠、足以觸發頁首收合」的位置，也就是頁面底部。
 *
 * 刻意不接受精確的目標值：收合前後的最大捲動量相差約 108px，任何落在那個區間裡的
 * 數字都會與最後的落點對不起來（issue #96 的成因）。要驗的是收合行為本身，
 * 「停在哪一個 px」從來不是這些 spec 的斷言對象。
 */
export async function scrollPastCollapse(page: Page): Promise<number> {
  await waitForScrollableHome(page)

  const landed = await settle(page, Number.MAX_SAFE_INTEGER)

  // 捲不到門檻就明講。靜默回傳的話，後面拿到的會是一句沒頭沒尾的 collapsed=false
  if (landed < HEADER_COLLAPSE_AT) {
    throw new Error(
      `scrollPastCollapse: 只捲到 ${landed}px，未達收合門檻 ${HEADER_COLLAPSE_AT}px——頁面內容不足以捲動`,
    )
  }

  return landed
}
