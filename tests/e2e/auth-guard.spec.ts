import { expect, test } from '@playwright/test'
import { GUEST_LOGIN_NAV_TIMEOUT_MS, waitForSandbox } from './support/guestSession'
import { PROTECTED_PAGES } from './support/protectedPages'

// 路由保護（issue #67）。E2E 不在 TDD Develop 的 job 內執行，跑在 Vercel preview URL 上。
//
// 「未登入」那一半在下面，「已登入」那一半在檔案末尾——後者原本測不到（要有訪客登入才
// 走得完），#66 落地之後補上了。Google 那條仍然走不完：Authorized redirect URI 不支援
// 萬用字元，而 preview 每個分支一個動態網址（Epic #47 的硬約束）。

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

// 已登入的那一半（issue #84 的回歸測試）。
//
// 為什麼這幾條非有不可：PR #82 把「沒有身分」的 GET /api/tanks 由 200 空清單改成 401，
// 而 SSR 那一次內部請求不會帶上使用者的 cookie，於是**已登入**的人開首頁會走進
//   SSR 的 /api/tanks → 401 → $api 攔截器導去 /login → middleware 讀得到 session → 導回 /
// 這條無限導向。unit 測試看不到它：那是三個各自正確的零件湊出來的結果。
test.describe('已登入', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('login-action-guest').click()
    // 訪客登入那一次導航的預算另計（#111）。底下每一條「已登入」的 test 都從這裡開始，
    // 這一句擦撞的話，失敗會長成「登入頁上找不到那個元素」——最花時間查的那一種。
    //
    // 加碼只給這一句：底下那幾句 `toHaveURL` 等的是 route middleware 的一次判斷
    // （身分已經在 cookie 裡了），量級與這裡差一個數量級，跟著加碼只會讓真的壞掉的
    // 導向多等三倍才回報。
    await expect(page).toHaveURL('/', { timeout: GUEST_LOGIN_NAV_TIMEOUT_MS })
    // #144：登入完成不等於示範資料備妥，複製已經移到首頁掛載之後
    await waitForSandbox(page)
  })

  // Given 我已經登入
  // When  我開啟（或重新整理）受保護的頁面
  // Then  該頁自己的正面標記出現
  // And   我沒有被導去登入頁
  //
  // ⚠ 順序不能對調（issue #146）。
  //
  // 這一組原本只驗網址與「登入頁的標記不存在」。後者是「某個東西不存在」，而 #84
  // 關掉 SSR 之後，`page.goto()` 回來時整個 app 還沒 mount——畫面上什麼都沒有，
  // 包括登入頁的標記。兩句因此在「頁面正常載入」與「頁面根本還沒開始畫」時同樣成立：
  // 某一頁在登入狀態下整頁壞掉（500、或一個 render 期的例外），網址不會變、
  // 登入頁的標記也不會出現，這組 test 照樣是綠的。#110 之後更容易空過。
  //
  // 所以先等這一頁自己的正面標記。哪一頁等哪一個寫在 support/protectedPages.ts，
  // 那張表由 unit 這一側逐頁證明「該頁 500 時它真的不會出現」。
  for (const { path, marker } of PROTECTED_PAGES) {
    test(`已登入開 ${path} 停在原地，看得到這一頁自己的內容`, async ({ page }) => {
      await page.goto(path)

      // 這一句通過＝app 已經 mount，而且畫出來的是這一頁自己的內容。
      // 底下兩句要在它之後才有意義——尤其 toHaveCount(0)。
      await expect(page.getByTestId(marker).first()).toBeVisible()

      await expect(page).toHaveURL(new RegExp(`${path.replace(/\//g, '\\/')}$`))
      await expect(page.getByTestId('login-screen')).toHaveCount(0)
    })
  }

  // 重新整理是這個 bug 最容易被踩到的入口：一次完整的載入，而不是 client 端換頁
  test('已登入重新整理首頁，仍然停在首頁並看得到自己的資料', async ({ page }) => {
    await page.reload()

    await expect(page).toHaveURL('/')
    await expect(page.getByTestId('login-screen')).toHaveCount(0)
    // 「沒有被導走」與「真的拿到資料」是兩件事——只驗網址的話，
    // 一頁空殼也會通過，而空殼正是 SSR 拿不到身分時畫出來的東西
    await expect(page.getByTestId('home-sticky-header')).toBeVisible()
  })

  // 已登入 → /login 沒必要再看，回首頁（resolveAuthRedirect 的另一半）
  test('已登入開 /login 會被帶回首頁', async ({ page }) => {
    await page.goto('/login')

    await expect(page).toHaveURL('/')
  })
})
