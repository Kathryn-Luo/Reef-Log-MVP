import { expect, test } from '@playwright/test'

// 登入畫面（issue #63）。E2E 不在 TDD Develop 的 job 內執行，跑在 Vercel preview URL 上。
//
// ⚠ 只驗「畫面」：兩顆按鈕的去向屬於 `nuxt-auth-utils`，那個套件尚未安裝，
// 按下去會落到還不存在的路由，所以這裡只驗 href，不點擊。

test('登入頁顯示 App 圖示、字標、主標題與兩行副標', async ({ page }) => {
  await page.goto('/login')

  await expect(page.getByTestId('login-app-mark')).toBeVisible()
  await expect(page.getByTestId('login-brand')).toHaveText('REEFLOG · 礁記')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('記錄你的海水缸')
  await expect(page.getByTestId('login-lead')).toContainText('水質、生物與保養，一站掌握。')
  await expect(page.getByTestId('login-lead')).toContainText('登入以在裝置間同步你的缸。')
})

// issue 的敘述：「目前僅提供 Google 登入與訪客登入」
test('只提供 Google 與訪客兩個入口', async ({ page }) => {
  await page.goto('/login')

  const actions = page.locator('[data-testid^="login-action-"]')

  await expect(actions).toHaveCount(2)
  await expect(page.getByTestId('login-action-google')).toContainText('使用 Google 繼續')
  await expect(page.getByTestId('login-action-guest')).toContainText('以訪客身分瀏覽')
})

// 兩個入口都指向 server 路由（OAuth 的起點 / 訪客 session 的建立），必須整頁導出去
test('兩個入口都是整頁導向的 server 路由，且各自帶著自己的圖示', async ({ page }) => {
  await page.goto('/login')

  await expect(page.getByTestId('login-action-google')).toHaveAttribute('href', '/auth/google')
  await expect(page.getByTestId('login-google-icon')).toBeVisible()

  await expect(page.getByTestId('login-action-guest')).toHaveAttribute('href', '/auth/guest')
  await expect(page.getByTestId('login-guest-icon')).toBeVisible()
})

// 還沒登入的人沒有缸可看，那五個 tab 按了也到不了任何地方；截圖上也沒有它
test('登入頁不顯示底部 tab 列', async ({ page }) => {
  await page.goto('/login')

  await expect(page.getByRole('navigation', { name: '主要導覽' })).toHaveCount(0)
})

test('頁尾的服務條款與隱私政策各自是一個連結', async ({ page }) => {
  await page.goto('/login')

  const terms = page.getByTestId('login-terms')

  await expect(terms).toHaveText('繼續即代表你同意服務條款與隱私政策')
  await expect(terms.getByRole('link', { name: '服務條款' })).toHaveAttribute('href', '/terms')
  await expect(terms.getByRole('link', { name: '隱私政策' })).toHaveAttribute('href', '/privacy')
})
