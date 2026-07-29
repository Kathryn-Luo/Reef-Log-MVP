import { expect, test } from '@playwright/test'

// 登入畫面（issue #47）。E2E 不在 TDD Develop 的 job 內執行，跑在 Vercel preview URL 上。
//
// ⚠ 這支只覆蓋「畫面」那一半。Story 的四條驗收條件（未登入導向登入頁、只看得到自己的
// 缸、對別人的缸 id 打 API 回 404/403、首次登入建立帳號）全都需要真的有 session，
// 而 session 要等 `nuxt-auth-utils` 與 Google / cookie 密鑰就位——那三件事依 CLAUDE.md
// 都要人類處理，本輪沒有做。理由與待辦寫在 PR 說明裡，這裡不寫成會恆綠的假測試。

test('登入頁顯示品牌、標題與說明', async ({ page }) => {
  await page.goto('/login')

  await expect(page.getByTestId('login-brand')).toContainText('REEFLOG')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('記錄你的海水缸')
  await expect(page.getByTestId('login-lead')).toContainText('水質、生物與保養')
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
test('兩個入口都是整頁導向的 server 路由', async ({ page }) => {
  await page.goto('/login')

  await expect(page.getByTestId('login-action-google')).toHaveAttribute('href', '/auth/google')
  await expect(page.getByTestId('login-action-guest')).toHaveAttribute('href', '/auth/guest')
})

// 還沒登入的人沒有缸可看，那五個 tab 按了也到不了任何地方；截圖上也沒有它
test('登入頁不顯示底部 tab 列', async ({ page }) => {
  await page.goto('/login')

  await expect(page.getByRole('navigation', { name: '主要導覽' })).toHaveCount(0)
})

test('頁尾註明繼續即代表同意服務條款與隱私政策', async ({ page }) => {
  await page.goto('/login')

  await expect(page.getByTestId('login-terms')).toContainText('繼續即代表你同意')
  await expect(page.getByTestId('login-terms')).toContainText('服務條款')
  await expect(page.getByTestId('login-terms')).toContainText('隱私政策')
})
