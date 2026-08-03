import { expect, test } from '@playwright/test'
import type { BrowserContext } from '@playwright/test'

// 訪客登入的分段計時（issue #98 的方向 A「先量再改」）。
// E2E 不在 TDD Develop 的 job 內執行，跑在 Vercel preview URL 上。
//
// #98 量到 `/auth/guest` 這一次請求要 9.4～14.8 秒，但沒有任何數據能分辨那 10 秒是花在
// 交易本身、Neon 連線建立、還是 Vercel 冷啟——B（減少往返）、C（縮小模板）、D（先進站
// 後複製）挑錯了就是白改。這支 spec 驗的不是「快不快」，而是**量得到**：
// preview 上真的跑一次，Server-Timing 裡就有那幾個分得開的數字。
//
// 刻意不斷言任何時間上限：這一輪要產出的是數據，不是效能目標。訂一個「connect 要小於
// 幾秒」只會在方向還沒選定之前先讓 E2E 變紅，而且那個門檻是憑空猜的。
//
// 這支自己管理身分（不用 support/guestSession 的自動登入）：要量的正是登入那一次請求。

/** 從 Server-Timing 這一行裡取出某個 metric 的 dur（毫秒），沒有那一段就是 undefined */
function durationOf(header: string, metric: string): number | undefined {
  const match = header.match(new RegExp(`(?:^|,)\\s*${metric.replaceAll('.', '\\.')};dur=(\\d+)`))

  return match ? Number(match[1]) : undefined
}

/** 走一次 /auth/guest，回傳那次回應上的 Server-Timing */
async function serverTiming(context: BrowserContext): Promise<string> {
  // maxRedirects: 0 —— 這支路由的終點是 302，跟著轉過去之後拿到的就是首頁的回應，
  // 上面沒有這次登入的計時
  const response = await context.request.get('/auth/guest', { maxRedirects: 0 })

  expect(response.status()).toBe(302)

  const header = response.headers()['server-timing']

  expect(header, '/auth/guest 的回應上沒有 Server-Timing').toBeTruthy()

  return header!
}

// Given 一位沒有 session 的訪客 / When 他走一次 /auth/guest
// Then 回應上量得到交易、Neon 連線建立與 Vercel 冷啟三者各自的耗時
test('第一次進站的回應分得出交易、連線建立與冷啟', async ({ browser }) => {
  const context = await browser.newContext()
  const timing = await serverTiming(context)

  // 三個猜測各自對應到一個量得到的數字，缺一個就是那個猜測仍然排除不掉
  for (const metric of ['total', 'connect', 'tx', 'boot', 'instance']) {
    expect(durationOf(timing, metric), `Server-Timing 少了 ${metric}：${timing}`).toBeGreaterThanOrEqual(0)
  }

  // 交易內部還要再分得開：時間花在讀模板還是逐缸寫入，對應的是完全不同的對策
  expect(durationOf(timing, 'tx.user'), timing).toBeGreaterThanOrEqual(0)
  expect(durationOf(timing, 'tx.sandbox.read'), timing).toBeGreaterThanOrEqual(0)

  // 數字要真的兜得起來：總計包得住交易，交易包得住它底下的每一段
  expect(durationOf(timing, 'total')!).toBeGreaterThanOrEqual(durationOf(timing, 'tx')!)
  expect(durationOf(timing, 'tx')!).toBeGreaterThanOrEqual(durationOf(timing, 'tx.user')!)

  await context.close()
})

// Given 模板名下有示範缸 / When 訪客第一次進站
// Then 逐缸的寫入各自量得到（分得出「每個缸都慢」與「只有主缸慢」）
test('逐缸的複製各自量得到', async ({ browser }) => {
  const context = await browser.newContext()
  const timing = await serverTiming(context)

  // 模板目前有 3 個缸（#98 內文）。這裡只要求「至少第一個缸量得到」——
  // 缸數是示範資料的內容，寫死在斷言裡會讓 seed 一改動這條就誤紅。
  expect(durationOf(timing, 'tx.sandbox.tank1'), timing).toBeGreaterThanOrEqual(0)

  await context.close()
})

// Given 我已有訪客 session / When 我再次走一遍 /auth/guest
// Then 計時裡沒有建沙盒的那幾段（Story ② 的「不重複複製」在數據上看得見）
test('再次進站量不到建沙盒的那幾段', async ({ browser }) => {
  const context = await browser.newContext()

  // 第一次：建帳號 + 複製沙盒
  await serverTiming(context)

  // 第二次：同一份 cookie，伺服器看到的是「已經有身分」的那一位
  const timing = await serverTiming(context)

  expect(durationOf(timing, 'total'), timing).toBeGreaterThanOrEqual(0)
  expect(durationOf(timing, 'session.read'), timing).toBeGreaterThanOrEqual(0)

  // 這三段只在「建一位新訪客」那條路徑上，出現就代表 Story ② 破了
  expect(durationOf(timing, 'connect'), timing).toBeUndefined()
  expect(durationOf(timing, 'tx'), timing).toBeUndefined()
  expect(durationOf(timing, 'tx.sandbox.read'), timing).toBeUndefined()

  await context.close()
})
