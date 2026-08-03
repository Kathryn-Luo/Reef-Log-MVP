import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'

// 需要登入才跑得完的 spec 共用的進站方式（issue #80）。
//
// #64 拿掉「一律取 createdAt 最早的那一位使用者」這個暫時實作之後，未登入的請求拿不到
// 任何資料；#67 更進一步把未登入的人從受保護的頁面帶去 /login。既有的 spec 全部是直接
// `page.goto('/')` 進站，於是一條都跑不完——本模組補的就是那個缺掉的登入步驟。
//
// 走訪客登入而不是 Google：Google 的 Authorized redirect URI 不支援萬用字元，而 Vercel
// 每個分支一個動態網址（Epic #47 的硬約束），所以訪客是 preview 上唯一走得通的登入路徑。
//
// ── 粒度：每個 test 一位訪客（issue #80 的做法 A）──
//
// 訪客登入會複製一份模板示範資料掛在新的 User 名下（#66），所以「一個 test 一次登入」
// ＝「一個 test 一份自己的沙盒」。另外兩種粒度都被否決過，理由留在這裡免得被回頭改掉：
//
//   B. globalSetup + storageState：全部 test 共用一個沙盒。tank-create 建的缸會被 home
//      看到，測試之間互相干擾——正是 #52 原本的問題。
//   C. worker-scoped fixture：同一個 worker 內共用。範圍小一點，但 `fullyParallel: true`
//      讓「誰跟誰同 worker」不可預期，干擾會以偶發失敗的形式出現。
//
// B 與 C 省下來的是資料庫列數，付出的是隔離。偶發、難重現的 E2E 失敗比多幾百列資料貴
// 得多，而累積本來就是 #52 / #70 要解決的題目——真人訪客一樣會累積。

/** 走一遍登入頁上的「以訪客身分瀏覽」，回來時人已經在首頁上。 */
export async function loginAsGuest(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('login-action-guest').click()

  // 停在首頁才算數：登入失敗時這支路由會把人留在 /login，
  // 少了這一句，後面每一條斷言都會以「登入頁上找不到那個元素」的形式失敗，
  // 看起來像是畫面壞了，而不是沒登入。
  await expect(page).toHaveURL('/')
}

/**
 * `@playwright/test` 的 `test`，外加「開場先以訪客身分登入」。
 *
 * 刻意做成 auto fixture 而不是要各 spec 自己呼叫：之後在這幾支裡新增的 test 會自動
 * 有身分，不必記得補一行。漏掉的代價很大——E2E 目前沒有地方執行（#23），
 * 一條沒有身分的 test 要等到有人手動跑 Playwright 才看得見。
 *
 * fixture 依賴 `page`，所以它在該 test 的 `page` 建好之後、test 本體之前跑；
 * `test.use({ viewport })` 這類設定照常生效。
 */
// fixture 本身沒有值可以給 test 用（它做的是副作用：讓 `page` 有身分），
// 型別因此取 null 而不是 Playwright 文件上的 void——void 只能當回傳型別，
// 寫在這裡會被 @typescript-eslint/no-invalid-void-type 擋下。
export const test = base.extend<{ guestSession: null }>({
  guestSession: [async ({ page }, use) => {
    await loginAsGuest(page)

    await use(null)
  }, { auto: true }],
})

export { expect }
