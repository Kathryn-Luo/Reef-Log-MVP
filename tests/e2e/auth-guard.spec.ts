import { expect, test } from '@playwright/test'

// 路由保護（issue #67）。E2E 不在 TDD Develop 的 job 內執行，跑在 Vercel preview URL 上。
//
// ⚠ 這裡只驗得到「未登入」那一半。取得登入狀態要走訪客登入（issue #66），那條路由
// 目前還不存在——Google 那條也走不完，Google 的 Authorized redirect URI 不支援萬用字元，
// 而 preview 每個分支一個動態網址（Epic #47 的硬約束）。所以
// 「已登入開 /login 會被導回首頁」與「已登入開受保護頁面正常顯示」兩條 Then
// 由 unit 測試（route-guard.test.ts、auth-middleware.test.ts）守著，
// 等 #66 落地之後再在這裡補上真的走一遍的版本。

/** issue 的「要保護的頁面」清單，外加一個尚未存在的生物 id（:id 那一條路由） */
const PROTECTED_PATHS = [
  '/',
  '/log',
  '/trends',
  '/creatures',
  '/creatures/not-a-real-id',
  '/maintenance',
  '/tanks/new',
]

// Given 我沒有登入 / When 我開啟首頁 / Then 我被導向 /login
// Given 我沒有登入 / When 我開啟 /log、/trends、/creatures、/creatures/<id>、
// /maintenance、/tanks/new 其中任何一頁 / Then 我被導向 /login
for (const path of PROTECTED_PATHS) {
  test(`未登入開 ${path} 會停在登入頁`, async ({ page }) => {
    await page.goto(path)

    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByTestId('login-screen')).toBeVisible()
  })
}

// And 畫面上沒有出現任何使用者的資料
//
// 「沒看到別人的資料」不能只靠網址判斷：導向如果發生在畫面畫出來之後，
// 那一瞬間該看到的東西已經看到了。這裡直接點名首頁上會出現資料的區塊。
test('未登入開首頁時，畫面上沒有任何缸或生物的資料', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveURL(/\/login$/)

  await expect(page.getByTestId('home-sticky-header')).toHaveCount(0)
  await expect(page.getByTestId('water-summary-row')).toHaveCount(0)
  await expect(page.getByTestId('creature-total')).toHaveCount(0)
  // 空狀態也算是「App 的內容」，未登入的人同樣不該看到
  await expect(page.getByTestId('tank-empty')).toHaveCount(0)
})

// 登入頁自己不能被攔，否則導向的目的地又被導向一次，人永遠到不了任何地方
test('登入頁與 OAuth 起點在未登入時開得起來', async ({ page }) => {
  await page.goto('/login')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByTestId('login-action-google')).toBeVisible()
})
