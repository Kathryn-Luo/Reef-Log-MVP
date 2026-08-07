import type { Page } from '@playwright/test'
import { expect, test } from './support/guestSession'

// 趨勢圖（issue #123 ＝ #12 的畫面那一半，screen-4）。
//
// 每個 test 開場先以訪客身分登入，各自拿到一份模板示範資料的複本（issue #80）。
// E2E 不在 TDD Develop 的 job 內執行，跑在 Vercel preview URL 上（#23）——這裡驗的是
// 「真的有一台伺服器、真的有一份資料時，圖會不會出現、切換會不會同步」，
// 版面、空狀態與載入樣態的細節由 tests/unit/pages/trends.test.ts 覆蓋。
//
// ⚠ 不要拿截圖上的數字當夾具，也不要對「某個區間有幾個點」寫死斷言。`prisma/seed.ts`
// 的 measuredAt 是 `pnpm db:seed` 執行當下算的，訪客沙盒又照原值整棵複製
// （server/utils/guestSandbox.ts 不重算時間），所以示範資料會隨著 preview 上次 seed 的
// 日子一天天變舊：seed 超過七天沒跑，「7 天」就是 0 個點；超過 30 天，「30 天」也空了。
// 這一課是 PR #138 踩出來的（water-log.spec.ts 有一條寫死「七天前」，隔天全紅）。
// 所以這一支一律先打一次 API 拿到「現在實際上是什麼」，再拿它當基準斷言畫面。

interface TrendSeries {
  parameter: string
  points: { measuredAt: string, value: number }[]
  latest: number | null
  average: number | null
  highest: number | null
  lowest: number | null
  change: { delta: number, days: number } | null
}

/** 這位訪客沙盒裡第一個缸的趨勢資料——也就是畫面拿到的那一份 */
async function fetchSeries(page: Page, range: string): Promise<TrendSeries[]> {
  const { request } = page.context()
  const { tanks } = await (await request.get('/api/tanks')).json() as { tanks: { id: string }[] }

  expect(tanks.length, '訪客沙盒裡沒有任何缸——preview 的資料庫可能沒跑過 pnpm db:seed').toBeGreaterThan(0)

  const { series } = await (await request.get(`/api/tanks/${tanks[0]!.id}/trends?range=${range}`))
    .json() as { series: TrendSeries[] }

  return series
}

const seriesOf = (series: TrendSeries[], parameter: string) =>
  series.find(candidate => candidate.parameter === parameter)!

/**
 * 等到資料到齊、畫面切到「有缸」那一支為止。
 *
 * 等的是**正面訊號**（元素 tab 出現），不是「載入樣態消失」。#84 之後是 SPA，
 * `page.goto()` 回來時整個 app 還沒 mount，骨架的筆數在「還沒開始載入」與「載入完了」
 * 兩個時刻同樣都是 0——拿它當閘門的話，這個等待在 hydration 之前就先通過了（#129）。
 */
async function expectLoaded(page: Page) {
  await expect(page.getByTestId('parameter-tab').first()).toBeVisible()
}

/**
 * 畫面上的數字 → number。
 *
 * 只比數值不比字面，顯示格式（小數位、PO₄ 省略前導 0）由
 * tests/unit/shared/water-quality.test.ts 守著，這裡不重述一份。
 */
const numberOf = async (page: Page, testId: string) =>
  Number(await page.getByTestId(testId).textContent())

/** 該測項的顯示精度下，API 給的值會被畫成哪個數字 */
const rounded = (value: number, decimals: number) => Number(value.toFixed(decimals))

const KH_DECIMALS = 1

/** 每一次瀏覽器送出的 GET /trends。切 tab 不該讓它變長 */
function watchTrendRequests(page: Page): string[] {
  const urls: string[] = []

  page.on('request', (request) => {
    if (request.url().includes('/trends')) {
      urls.push(request.url())
    }
  })

  return urls
}

// Given 我進入「趨勢」頁 / When 畫面載入
// Then 頁首顯示「趨勢」與副標「<缸名> · <尺寸>」
// And  六個元素 tab 中「KH」預設選中 / And 時間範圍預設選中「30 天」
test('頁首、六個元素 tab 與四顆範圍按鈕，預設是 KH + 30 天', async ({ page }) => {
  await page.goto('/trends')

  await expectLoaded(page)

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('趨勢')
  // 缸名之後是尺寸。示範資料的缸名固定，尺寸則是可以留白的欄位
  await expect(page.getByTestId('trends-subtitle')).toHaveText(/^主缸( · .+)?$/)

  await expect(page.getByTestId('parameter-tab')).toHaveText(['KH', 'Ca', 'Mg', 'NO₃', 'PO₄', '鹽度'])
  await expect(page.getByTestId('range-button')).toHaveText(['7 天', '30 天', '90 天', '全部'])

  await expect(page.locator('[data-testid="parameter-tab"][data-parameter="KH"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-testid="range-button"][data-range="30d"]')).toHaveAttribute('aria-pressed', 'true')
})

// Given 我選中 KH 且範圍為 30 天 / When 圖表渲染
// Then 上方大字顯示該區間最新一筆的值與單位
test('大字與統計摘要就是 API 回的那一組數字', async ({ page }) => {
  await page.goto('/trends')

  await expectLoaded(page)

  const kh = seriesOf(await fetchSeries(page, '30d'), 'KH')

  await expect(page.getByTestId('trend-unit')).toHaveText('dKH')

  if (!kh.points.length) {
    // 示範資料隨上次 seed 的日子漂移，「30 天內沒有 KH 的記錄」是允許的樣子之一。
    // 這時要看到的是空狀態文案與三個「—」，而不是 0 或 NaN。
    await expect(page.getByTestId('trend-chart-empty')).toBeVisible()
    await expect(page.getByTestId('trend-stat-value')).toHaveText(['—', '—', '—'])
    return
  }

  await expect(page.getByTestId('line-chart').locator('svg')).toBeVisible()
  expect(await numberOf(page, 'trend-latest')).toBe(rounded(kh.latest!, KH_DECIMALS))

  const [average, highest, lowest] = await page.getByTestId('trend-stat-value').allTextContents()

  expect(Number(average)).toBe(rounded(kh.average!, KH_DECIMALS))
  expect(Number(highest)).toBe(rounded(kh.highest!, KH_DECIMALS))
  expect(Number(lowest)).toBe(rounded(kh.lowest!, KH_DECIMALS))
})

// Given 我點擊另一個元素 tab（如 Ca）/ When 切換完成
// Then 折線、單位、統計摘要全部改為該元素的資料
// And  不重新發出網路請求（六個測項在同一份回應裡）
test('切到 Ca 之後畫面同步更新，而且沒有再打一次 API', async ({ page }) => {
  const requests = watchTrendRequests(page)

  await page.goto('/trends')

  await expectLoaded(page)
  // 首屏那一次請求要先確實落地，否則下面的「沒有變長」會把它算成切 tab 造成的
  await expect(page.getByTestId('trend-unit')).toHaveText('dKH')

  const before = requests.length

  expect(before, '進站至少要打過一次 /trends').toBeGreaterThan(0)

  const ca = seriesOf(await fetchSeries(page, '30d'), 'CA')

  await page.locator('[data-testid="parameter-tab"][data-parameter="CA"]').click()

  await expect(page.locator('[data-testid="parameter-tab"][data-parameter="CA"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-testid="parameter-tab"][data-parameter="KH"]')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('trend-unit')).toHaveText('ppm')

  if (ca.points.length) {
    expect(await numberOf(page, 'trend-latest')).toBe(rounded(ca.latest!, 0))
  }
  else {
    await expect(page.getByTestId('trend-chart-empty')).toContainText('Ca')
  }

  expect(requests.length, '六個測項在同一份回應裡，切 tab 不該再打一次').toBe(before)
})

// Given 我切換時間範圍為「全部」/ When 切換完成
// Then 折線只包含該區間內的量測，統計摘要與變化量依該區間重新計算
test('切到「全部」之後帶著新的 range 重新請求，畫面換成該區間的數字', async ({ page }) => {
  const requests = watchTrendRequests(page)

  await page.goto('/trends')

  await expectLoaded(page)
  await expect(page.getByTestId('trend-unit')).toHaveText('dKH')

  const all = seriesOf(await fetchSeries(page, 'all'), 'KH')

  test.skip(!all.points.length, '這個沙盒完全沒有 KH 的記錄；preview 的資料庫可能沒跑過 pnpm db:seed')

  await page.locator('[data-testid="range-button"][data-range="all"]').click()

  await expect(page.locator('[data-testid="range-button"][data-range="all"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-testid="range-button"][data-range="30d"]')).toHaveAttribute('aria-pressed', 'false')

  // 「全部」一定有資料（上面 skip 過了），所以這裡等的是圖本身出現——正面訊號
  await expect(page.getByTestId('line-chart').locator('svg')).toBeVisible()

  // ⚠ 這一條要用會重試的 poll，不能用一次性的 expect。
  //
  // 換範圍比首次載入多一拍：watch 先觸發 refresh，之後才輪得到那兩支串起來的請求
  // （tests/unit/pages/trends.test.ts 的 selectRange 就是為了這一拍多 flush 一次）。
  // 而下面那條數字斷言**擋不住這一拍**——示範資料最新的一筆通常落在 30 天內，
  // 「30 天」與「全部」的 latest 因此是同一個數字，畫面根本不必更新就已經相等了。
  // 兩者湊在一起的結果是：請求還在路上，一次性的 expect 已經先跑完並判失敗。
  // 實際踩過（run 31157924044，三次重試全紅）。
  await expect.poll(
    () => requests.filter(url => url.includes('range=all')).length,
    { message: '換範圍要重新問 server' },
  ).toBeGreaterThan(0)

  await expect(async () => {
    expect(await numberOf(page, 'trend-latest')).toBe(rounded(all.latest!, KH_DECIMALS))
  }).toPass()
})

// And 變化量顯示方向（下降 ▼ / 上升 ▲）；只有一筆讀值時整塊不顯示
test('變化量的方向與 API 回的 change 一致', async ({ page }) => {
  await page.goto('/trends')

  await expectLoaded(page)

  await page.locator('[data-testid="range-button"][data-range="all"]').click()
  await expect(page.locator('[data-testid="range-button"][data-range="all"]')).toHaveAttribute('aria-pressed', 'true')

  const all = seriesOf(await fetchSeries(page, 'all'), 'KH')
  const change = page.getByTestId('trend-change')

  if (!all.change) {
    // 0 筆或 1 筆：一筆算不出「變化」，整塊不顯示（不能出現「▲ 0」或 NaN）
    await expect(change).toHaveCount(0)
    return
  }

  const direction = all.change.delta < 0 ? 'down' : all.change.delta > 0 ? 'up' : 'flat'

  await expect(change).toHaveAttribute('data-direction', direction)
  await expect(page.getByTestId('trend-change-value')).toContainText(`（${all.change.days} 天）`)
})
