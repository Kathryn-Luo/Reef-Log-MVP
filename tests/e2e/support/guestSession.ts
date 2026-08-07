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

/**
 * 「按下訪客登入 → 停在首頁、示範資料備妥」整段的等待預算（issue #111）。
 *
 * ⚠ issue #144 之後這段等待**換了地方**，但總長度沒有變。複製示範資料那 11.5 秒從
 * `/auth/guest` 這次請求裡搬到了首頁掛載之後的 `POST /api/guest-sandbox`——使用者因此
 * 早得多就看得到畫面，但「從按下按鈕到示範資料真的在手上」仍然是同一個量級。
 * 這個常數涵蓋的正是後者，所以照舊。
 *
 * `/auth/guest` 這一次請求在 preview 上實測 9.4～14.8 秒（#98 量了 5 次）：訪客登入要建
 * 一位 User、再把模板的示範資料整份複製一份（#66），加上 Vercel 冷啟與 Neon 建立連線。
 * 全域的 `expect.timeout` 是 15 秒（`playwright.config.ts`，#95），只比觀測到的最慢值多
 * 0.2 秒——冷啟那幾次必然擦撞，`api-authorization.spec.ts` 第一次在 CI 上跑就三條全倒在
 * 這一句、重試才過。
 *
 * 為什麼不改全域那 15 秒：它是照「SPA 多一次 API 往返（+1.5～3 秒）」訂的，拉高的代價是
 * 每一個**真的**壞掉的斷言都要多等三倍才回報。全站只有「等一次訪客登入」需要這個量級，
 * 所以加碼只給那幾句，其餘照舊。
 *
 * 45 秒 ≈ 觀測上限的三倍：冷啟再慢一次也還有餘裕，而且遠在 test timeout（90 秒）之內，
 * 逾時的時候仍然是這一句自己說話，不是整條 test 被砍掉。
 *
 * 數字集中在這裡而不是各處各寫一個：分散寫的話下次調整只會改到其中幾處，
 * 其餘的會安靜地留在舊值上。#98 若把 `/auth/guest` 改快了，這個常數會跟著變小或消失。
 */
export const GUEST_LOGIN_NAV_TIMEOUT_MS = 45_000

/**
 * 等示範資料真的備妥（issue #144）。
 *
 * ⚠ 網址變成 `/` 只代表**登入**完成，示範資料可能還在複製。
 *
 * #144 把複製從 `/auth/guest` 搬到首頁掛載之後的 `POST /api/guest-sandbox`，302 因此
 * 發得比從前早得多（實測 14.8 秒 → 約 2.8 秒）。代價是 `toHaveURL('/')` 通過的那一刻
 * `/api/tanks` 可能還是空的——少了這一句，接著 `goto('/log')` 或直接打 API 的 spec
 * 會看到「還沒有任何缸」。
 *
 * ── 為什麼自己打 API，而不是等首頁去打 ──
 *
 * 第一版等的是首頁的 `home-sticky-header`。它會動，但**壞掉的時候什麼都不會說**：
 * 逾時訊息一律是「找不到那個元素」，而真正的原因可能是登入沒成功、沙盒那支 API 回 500、
 * 模板沒 seed、或首頁沒在對的時機呼叫——四者在畫面上長得一模一樣。E2E 一輪要 45 分鐘，
 * 一個講不出原因的逾時等於白跑一輪（實際踩過：run 31169806875，138 條裡除了不需登入的
 * 4 條以外全紅，而 run 撞上 45 分鐘上限，連報表都沒產出）。
 *
 * 現在直接呼叫 `POST /api/guest-sandbox` 並確認 `/api/tanks` 真的有東西：拿得到狀態碼
 * 與回應本文，失敗訊息因此直接指向出問題的那一層。fixture 的職責本來就是
 * 「給我一位有資料的訪客」，不是「確認首頁畫好了」——後者是 home 那一支自己的題目。
 *
 * 預算沿用登入那一個常數：搬家之後這 11.5 秒還在，只是換了個地方等。
 */
export async function waitForSandbox(page: Page): Promise<void> {
  const { request } = page.context()

  // 自己打，不等首頁去打。
  //
  // 這支 API 是冪等的（server/utils/guestSandbox.ts 的 claim），所以與首頁自己那一次
  // 併發也只會複製一份——最壞情況是兩邊各等一次同一個交易。
  const response = await request.post('/api/guest-sandbox', { timeout: GUEST_LOGIN_NAV_TIMEOUT_MS })
  const body = await response.text()

  expect(response.status(), `POST /api/guest-sandbox 回了 ${response.status()}：${body}`).toBe(200)

  // 補建說成功了，資料就該真的在。這一句分得出「API 說它做了」與「東西真的在」——
  // 模板沒 seed 過時前者照樣是 200，而 copied 會是 0
  const tanks = await request.get('/api/tanks')
  const tanksBody = await tanks.text()

  expect(tanks.status(), `GET /api/tanks 回了 ${tanks.status()}：${tanksBody}`).toBe(200)
  expect(
    (JSON.parse(tanksBody) as { tanks: unknown[] }).tanks.length,
    `沙盒是空的。補建回的是：${body}——preview 的資料庫可能沒跑過 pnpm db:seed`,
  ).toBeGreaterThan(0)
}

/** 走一遍登入頁上的「以訪客身分瀏覽」，回來時人已經在首頁上、示範資料也已經在手上。 */
export async function loginAsGuest(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('login-action-guest').click()

  // 停在首頁才算數：登入失敗時這支路由會把人留在 /login，
  // 少了這一句，後面每一條斷言都會以「登入頁上找不到那個元素」的形式失敗，
  // 看起來像是畫面壞了，而不是沒登入。
  await expect(page).toHaveURL('/', { timeout: GUEST_LOGIN_NAV_TIMEOUT_MS })

  await waitForSandbox(page)
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
