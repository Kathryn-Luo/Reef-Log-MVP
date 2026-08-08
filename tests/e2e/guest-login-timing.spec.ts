import { expect, test } from '@playwright/test'
import type { BrowserContext } from '@playwright/test'

// 訪客登入的分段計時（issue #98 的方向 A「先量再改」，issue #144 的驗收條件）。
// E2E 不在 TDD Develop 的 job 內執行，跑在 Vercel preview URL 上。
//
// #98 量到 `/auth/guest` 這一次請求要 9.4～14.8 秒，但分不出那 10 秒花在哪。
// 這支 spec 加的計時把它分開了，2026-08-07 讀到的一次（冷啟）是：
//
//   total 14822 = connect 1439 + tx 13376（tx.user 1377 + tx.sandbox.* 11556）+ 其餘
//
// 結論：**78% 在複製示範資料，不在連線**。#144 因此把複製整段移出這次請求。
//
// ── 這支 spec 現在的職責 ──
//
// #144 的驗收條件本文：「/auth/guest 在複製任何示範資料之前就回 302，該回應的
// X-Guest-Timing 裡不再出現任何 tx.sandbox.* 段落」。
//
// 刻意驗「段落不存在」而不是「要在 N 秒內」：秒數在 preview 上會隨冷啟與 Neon 負載跳動，
// 寫死只是製造 flaky（#111 已經踩過一次，全域 15 秒上限只比觀測最慢值多 0.2 秒）。
// 而「複製不在這次請求裡」是結構性的，驗得準，也正是真正要保證的事——
// 它擋得住「有人把 copyTemplateSandbox 加回登入路徑」這個唯一會讓等待復活的改動。
//
// 這支自己管理身分（不用 support/guestSession 的自動登入）：要量的正是登入那一次請求。

/** 從 Server-Timing 這一行裡取出某個 metric 的 dur（毫秒），沒有那一段就是 undefined */
function durationOf(header: string, metric: string): number | undefined {
  const match = header.match(new RegExp(`(?:^|,)\\s*${metric.replaceAll('.', '\\.')};dur=(\\d+)`))

  return match ? Number(match[1]) : undefined
}

/**
 * 走一次 /auth/guest，回傳那次回應上的計時標頭。
 *
 * 讀 `X-Guest-Timing` 而不是 `Server-Timing`：**後者到不了 preview 的客戶端**。
 * 這支 spec 第一次在 CI 上跑（run 30809735121）時三條全部拿到 `undefined`，三次重試皆然；
 * 本機用同版 h3 重現「setResponseHeader → return sendRedirect」的形狀，302 上標頭都還在，
 * 所以吃掉它的是 Vercel 那一層（它自己也用 Server-Timing 回報邊緣的量測）。
 * handler 兩個都發，內容一模一樣——這裡讀不會被改寫的那一個。
 */
async function serverTiming(context: BrowserContext): Promise<string> {
  // maxRedirects: 0 —— 這支路由的終點是 302，跟著轉過去之後拿到的就是首頁的回應，
  // 上面沒有這次登入的計時
  const response = await context.request.get('/auth/guest', { maxRedirects: 0 })

  expect(response.status()).toBe(302)

  const header = response.headers()['x-guest-timing']

  expect(header, '/auth/guest 的回應上沒有 X-Guest-Timing').toBeTruthy()

  return header!
}

// Given 一位沒有 session 的訪客 / When 他走一次 /auth/guest
// Then 回應上量得到剩下那幾段各自的耗時
test('第一次進站的回應分得出建帳號、連線建立與冷啟', async ({ browser }) => {
  const context = await browser.newContext()
  const timing = await serverTiming(context)

  // #144 之後這次請求剩下的就是這幾段。下一次要再壓時間就得從 connect 與 user
  // 這兩個數字裡找——量不到就沒得找
  for (const metric of ['total', 'connect', 'user', 'boot', 'instance']) {
    expect(durationOf(timing, metric), `X-Guest-Timing 少了 ${metric}：${timing}`).toBeGreaterThanOrEqual(0)
  }

  // 數字要真的兜得起來：總計包得住它底下的每一段
  expect(durationOf(timing, 'total')!).toBeGreaterThanOrEqual(durationOf(timing, 'user')!)
  expect(durationOf(timing, 'total')!).toBeGreaterThanOrEqual(durationOf(timing, 'connect')!)

  await context.close()
})

// issue #144 的驗收條件：
//   Given 我是第一次進站的訪客 / When 我按下「以訪客身分瀏覽」
//   Then  /auth/guest 在複製任何示範資料之前就回 302
//   And   該回應的 X-Guest-Timing 裡不再出現任何 tx.sandbox.* 段落
test('複製示範資料不在這次請求裡', async ({ browser }) => {
  const context = await browser.newContext()
  const timing = await serverTiming(context)

  // 這三段全部屬於複製鏈（server/utils/guestSandbox.ts）。出現任何一段，
  // 就代表那 11.5 秒又回到了 302 之前——使用者會退回「按了按鈕之後乾等十幾秒」
  for (const metric of ['tx', 'tx.sandbox.read', 'tx.sandbox.tank1']) {
    expect(durationOf(timing, metric), `複製又跑回登入請求裡了：${timing}`).toBeUndefined()
  }

  await context.close()
})

// Given 我已有訪客 session / When 我再次走一遍 /auth/guest
// Then 計時裡沒有建帳號的那幾段（Story ② 的「不再建一位」在數據上看得見）
test('再次進站量不到建帳號的那幾段', async ({ browser }) => {
  const context = await browser.newContext()

  // 第一次：建帳號 + 複製沙盒
  await serverTiming(context)

  // 第二次：同一份 cookie，伺服器看到的是「已經有身分」的那一位
  const timing = await serverTiming(context)

  expect(durationOf(timing, 'total'), timing).toBeGreaterThanOrEqual(0)
  expect(durationOf(timing, 'session.read'), timing).toBeGreaterThanOrEqual(0)

  // 這兩段只在「建一位新訪客」那條路徑上，出現就代表 Story ② 破了
  expect(durationOf(timing, 'connect'), timing).toBeUndefined()
  expect(durationOf(timing, 'user'), timing).toBeUndefined()

  await context.close()
})
