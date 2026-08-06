import type { Page } from '@playwright/test'
import { expect, test } from './support/guestSession'

// 記錄水質（issue #124 ＝ #11 的畫面那一半，screen-3）。
//
// 每個 test 開場先以訪客身分登入，各自拿到一份模板示範資料的複本（issue #80）——
// 這一支每條 test 都會寫入水質記錄，寫在自己的沙盒裡，不會被別的 test 看到。
//
// E2E 不在 TDD Develop 的 job 內執行，跑在 Vercel preview URL 上（#23）。
// 「填寫 → 儲存 → 出現在歷史最上方」這條路徑要真的有資料庫才驗得到，
// 所以主線留在這裡；欄位規則與排版的細節由 unit 測試覆蓋。

/**
 * 等到資料到齊、畫面切到「有缸」那一支為止。
 *
 * 這裡刻意等**正面的訊號**（表單出現），不是等載入樣態消失。`/log` 在 #84 之後是
 * SPA，`page.goto()` 回來時整個 app 都還沒 mount，`getByTestId('water-log-loading')`
 * 的筆數在「還沒開始載入」與「載入完了」兩個時刻同樣都是 0——拿它當閘門的話，
 * 這個等待在 hydration 之前就先通過了，等於沒等。
 *
 * 表單與歷史列表在同一個 `v-else` 分支裡（app/pages/log.vue），所以表單可見就代表
 * 歷史那一段也已經渲染完，`locator.count()`（一次性快照、不會自動等待）這時才數得準。
 */
async function expectLoaded(page: Page) {
  await expect(page.getByTestId('water-log-form')).toBeVisible()
}

// Given 我進入「記錄水質」頁 / When 畫面載入
// Then 頁首顯示「記錄水質」與副標「<缸名> · <尺寸>」，六個元素輸入欄依序排列
test('頁首與六個元素輸入欄', async ({ page }) => {
  await page.goto('/log')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('記錄水質')
  await expect(page.getByTestId('water-log-subtitle')).toHaveText('主缸 · 4 尺')
  await expect(page.getByTestId('reading-label')).toHaveText(['KH', 'Ca', 'Mg', 'NO₃', 'PO₄', '鹽度'])
  await expect(page.getByTestId('reading-unit')).toHaveText(['dKH', 'ppm', 'ppm', 'ppm', 'ppm', 'SG'])
})

// Given 我只填了 KH、Ca、Mg / When 我點擊「儲存這筆記錄」
// Then 建立一筆量測記錄 / And 歷史記錄列表最上方出現這筆新記錄
test('填寫三項後儲存，新記錄出現在歷史最上方', async ({ page }) => {
  await page.goto('/log')

  await expectLoaded(page)

  await page.locator('input[name="KH"]').fill('7.8')
  await page.locator('input[name="CA"]').fill('412')
  await page.locator('input[name="MG"]').fill('1180')
  await page.getByTestId('water-log-submit').click()

  const first = page.getByTestId('history-row').first()
  await expect(first.getByTestId('history-summary')).toHaveText('KH 7.8 · Ca 412 · Mg 1180')
  await expect(first.getByTestId('history-ago')).toHaveText('剛剛')

  // 成功不跳頁，輸入欄清空——輸入區與歷史區在同一頁，成功的證據就是它出現在下面
  await expect(page).toHaveURL(/\/log$/)
  await expect(page.locator('input[name="KH"]')).toHaveValue('')

  // 剛存下的值成為下一次的「上次」
  await expect(page.getByTestId('reading-field').filter({ hasText: 'KH' }).first()
    .getByTestId('reading-previous')).toHaveText('上次 7.8')
})

// Given 我六項全部留空 / When 我點擊「儲存這筆記錄」
// Then 顯示錯誤提示「至少填寫一項讀值」，不建立任何記錄
test('六項全空時擋下儲存', async ({ page }) => {
  await page.goto('/log')

  await expectLoaded(page)

  const rows = page.getByTestId('history-row')
  const before = await rows.count()

  await page.getByTestId('water-log-submit').click()

  await expect(page.getByTestId('water-log-error')).toContainText('至少填寫一項讀值')
  await expect(rows).toHaveCount(before)
})

// Given 我在 KH 欄輸入非數字或負數 / When 欄位失焦 / Then 顯示該欄的驗證錯誤，且儲存被阻擋
test('非法讀值在失焦時就標示出來，並擋下儲存', async ({ page }) => {
  await page.goto('/log')

  await expectLoaded(page)

  const rows = page.getByTestId('history-row')
  const before = await rows.count()

  await page.locator('input[name="KH"]').fill('-1')
  await page.locator('input[name="KH"]').blur()

  const field = page.getByTestId('reading-field').filter({ hasText: 'KH' }).first()
  await expect(field.getByTestId('reading-error')).toBeVisible()

  await page.getByTestId('water-log-submit').click()
  await expect(rows).toHaveCount(before)
})

// Given 該缸已有水質記錄 / When 我瀏覽頁面下方的「歷史記錄」
// Then 依量測時間新到舊列出，每列顯示「MM / DD · HH:mm」、三項摘要與相對時間
test('歷史記錄依時間新到舊，每列有時間、摘要與相對時間', async ({ page }) => {
  await page.goto('/log')

  const first = page.getByTestId('history-row').first()

  await expect(first.getByTestId('history-time')).toHaveText(/^\d{2} \/ \d{2} · \d{2}:\d{2}$/)
  await expect(first.getByTestId('history-summary')).not.toHaveText('')
  await expect(first.getByTestId('history-ago')).not.toHaveText('')
})
