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

const DAY = 24 * 60 * 60 * 1000

/** `<input type="date">` 吃的 `YYYY-MM-DD`，取當地的牆上日期 */
function dateInputValue(at: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

/**
 * 這個沙盒裡 KH「最近一筆已存在的讀值」是什麼時候量的。
 *
 * 補記的日期要比它更舊才測得到這條 Story，而那個「更舊」不能用 `Date.now()` 往回推：
 * 示範資料的 `measuredAt` 是 `pnpm db:seed` 執行當下算的（最新一筆是「4 小時前」），
 * 訪客沙盒又是照原值整棵複製過去的（server/utils/guestSandbox.ts 不重算時間），
 * 所以那筆「最新」會隨著 preview 資料庫上次 seed 的日子一天天變舊。
 * 寫死「七天前」的話，seed 超過七天沒跑，補記的那一筆就反過來成了最新的一筆——
 * 覆蓋是對的行為，紅掉的是測試自己。實際踩過一次：同一份程式碼前一天全綠、隔天全紅。
 *
 * 改成以那一筆的時間為錨，往前一天。不論 preview 的示範資料多舊都成立。
 */
async function latestKhMeasuredAt(page: Page): Promise<Date> {
  const { request } = page.context()
  const { tanks } = await (await request.get('/api/tanks')).json() as { tanks: { id: string }[] }

  expect(tanks.length, '訪客沙盒裡沒有任何缸——preview 的資料庫可能沒跑過 pnpm db:seed').toBeGreaterThan(0)

  // 這支端點回的就是 WaterLogPageData 本身（`{ previousReadings, waterLogs }`）。
  // `/log` 那邊看到的 `data.page.previousReadings` 多一層是因為頁面把缸與這一段
  // 串成同一個 useAsyncData，那是 composable 組出來的形狀，不是 API 的。
  const { previousReadings } = await (await request.get(`/api/tanks/${tanks[0]!.id}/water-logs`)).json() as {
    previousReadings: { parameter: string, measuredAt: string }[]
  }
  const kh = previousReadings.find(reading => reading.parameter === 'KH')

  expect(kh, 'KH 從未被記錄過，這條 Story 就沒有「較新的讀值」可以被蓋掉').toBeDefined()

  return new Date(kh!.measuredAt)
}

// Given KH 欄顯示「上次 <值>」（來自最近一次量測）
// When  我把日期改成比那一筆更早的一天，KH 填一個不同的值，按下儲存
// Then  KH 欄的「上次」不變——補記的那一筆不是「最近一筆已存在的讀值」（issue #131）
//
// 只影響尚未重新整理的畫面，unit 覆蓋得完整（issue #131 的判斷），這裡補一條主線：
// 樂觀更新用的是本地那份歷史，真的走一次「填 → 存 → 回寫」才看得到它串對了沒有。
test('補記較早的量測，不會把 KH 的「上次」蓋成較舊的讀值', async ({ page }) => {
  const backdate = new Date((await latestKhMeasuredAt(page)).getTime() - DAY)

  await page.goto('/log')

  await expectLoaded(page)

  const rows = page.getByTestId('history-row')
  const before = await rows.count()

  const kh = page.getByTestId('reading-field').filter({ hasText: 'KH' }).first()
  const previous = await kh.getByTestId('reading-previous').textContent()

  await page.locator('input[name="measuredDate"]').fill(dateInputValue(backdate))
  await page.locator('input[name="KH"]').fill('6.5')
  await page.getByTestId('water-log-submit').click()

  // 記錄本身存下來了（歷史多一列），但「上次」仍然是那筆較新的量測
  await expect(rows).toHaveCount(before + 1)
  await expect(kh.getByTestId('reading-previous')).toHaveText(previous!)
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
