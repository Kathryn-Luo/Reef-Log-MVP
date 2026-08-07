import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext } from '@playwright/test'
import { GUEST_LOGIN_NAV_TIMEOUT_MS } from './support/guestSession'

// 訪客沙盒的補建（issue #144）。
// E2E 不在 TDD Develop 的 job 內執行，跑在 Vercel preview URL 上。
//
// 這支刻意**只走 API，不開任何頁面**，而且自己管理身分（不用 support/guestSession 的
// 自動登入）。理由是分層：#144 把複製從登入請求搬到了 `POST /api/guest-sandbox`，
// 這條鏈上有三層可能出錯——
//
//   ① /auth/guest 建不出帳號        ② POST /api/guest-sandbox 複製不了
//   ③ 首頁沒有在對的時機呼叫它
//
// 其他 spec 全部透過畫面驗，三者壞掉時看起來一模一樣（「找不到那個元素」）。
// 這一支把 ① 與 ② 單獨釘住，剩下的才輪得到 ③。E2E 一輪要 45 分鐘，
// 分不出層的失敗等於白跑一輪——第一次跑 #144 就是這樣（run 31169806875，
// 138 條裡除了不需登入的 4 條以外全紅，而 run 被 45 分鐘上限砍掉，連報表都沒產出）。

/** 走一次 /auth/guest，回傳 302 的 Location。不跟著轉過去——要驗的就是這一次回應。 */
async function signInAsGuest(context: BrowserContext): Promise<string> {
  const response = await context.request.get('/auth/guest', {
    maxRedirects: 0,
    timeout: GUEST_LOGIN_NAV_TIMEOUT_MS,
  })

  const timing = response.headers()['x-guest-timing'] ?? '（沒有計時標頭）'

  expect(response.status(), `/auth/guest 沒有回 302，計時：${timing}`).toBe(302)

  // 失敗時這支路由會把人留在 /login（見 server/routes/auth/guest.get.ts 的 catch），
  // 而它仍然是一個 302——只看狀態碼會把「登入失敗」讀成「登入成功」
  const location = response.headers().location ?? ''

  expect(location, `訪客登入失敗，被導回 ${location}。計時：${timing}`).toBe('/')

  return location
}

/** 打一次補建沙盒的 API，回傳解析後的內容；非 200 時把本文帶進失敗訊息 */
async function ensureSandbox(request: APIRequestContext) {
  const response = await request.post('/api/guest-sandbox', { timeout: GUEST_LOGIN_NAV_TIMEOUT_MS })
  const body = await response.text()

  expect(response.status(), `POST /api/guest-sandbox 回了 ${response.status()}：${body}`).toBe(200)

  return JSON.parse(body) as { copied: number, alreadySeeded: boolean }
}

const tankCount = async (request: APIRequestContext) => {
  const response = await request.get('/api/tanks')
  const body = await response.text()

  expect(response.status(), `GET /api/tanks 回了 ${response.status()}：${body}`).toBe(200)

  return (JSON.parse(body) as { tanks: unknown[] }).tanks.length
}

// Given 我是第一次進站的訪客
// When  /auth/guest 回 302 之後我還沒呼叫補建
// Then  我有身分，但名下還沒有任何缸
//
// 這一條把 #144 最核心的行為改變直接寫成斷言：**登入不再附帶示範資料**。
// 它同時是上面那 2.8 秒的來源——302 不必等那 11.5 秒的複製。
test('登入本身不再複製示範資料', async ({ browser }) => {
  const context = await browser.newContext()

  await signInAsGuest(context)

  expect(await tankCount(context.request), '登入這一步就把沙盒建好了——複製又跑回 /auth/guest 裡了').toBe(0)

  await context.close()
})

// Given 我已經登入、沙盒還欠著 / When 首頁呼叫 POST /api/guest-sandbox
// Then 示範資料進到我名下
test('補建之後示範資料就在名下了', async ({ browser }) => {
  const context = await browser.newContext()

  await signInAsGuest(context)

  const result = await ensureSandbox(context.request)

  expect(result.alreadySeeded, '伺服器說沒有欠著的沙盒，但登入才剛建完帳號').toBe(false)
  expect(result.copied, '模板名下沒有缸——preview 的資料庫可能沒跑過 pnpm db:seed').toBeGreaterThan(0)
  expect(await tankCount(context.request)).toBe(result.copied)

  await context.close()
})

// Given 我的沙盒已經備妥 / When 再呼叫一次（重新整理、兩個分頁、連點）
// Then 不會複製第二份
//
// 冪等的機制是交易裡那句 `updateMany({ where: { sandboxSeededAt: null } })`
// （server/utils/guestSandbox.ts）。unit 測試以假 client 驗過它的形狀，
// 這裡驗的是它在真的 Postgres 上真的擋得住。
test('再呼叫一次不會複製第二份', async ({ browser }) => {
  const context = await browser.newContext()

  await signInAsGuest(context)

  const first = await ensureSandbox(context.request)
  const after = await tankCount(context.request)

  const second = await ensureSandbox(context.request)

  expect(second).toEqual({ copied: 0, alreadySeeded: true })
  expect(await tankCount(context.request), `第二次呼叫多長出了缸：${first.copied} → ${after}`).toBe(after)

  await context.close()
})

// Given 我沒有登入 / Then 回 401
//
// 這一支是唯一一支**不需要任何既有資料就會寫入**的 API：折成 200 的話，
// 沒有 cookie 的請求也能讓資料庫長出一整份示範資料。
// api-authorization.spec.ts 的清單裡也有它，這裡再放一次是因為那一支有 beforeAll——
// 登入一壞，整個 describe 會被跳過，那條防線就跟著消失了。
test('未登入時回 401', async ({ browser }) => {
  const context = await browser.newContext()

  const response = await context.request.post('/api/guest-sandbox')

  expect(response.status()).toBe(401)

  await context.close()
})
