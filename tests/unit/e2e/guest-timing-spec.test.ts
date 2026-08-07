// @vitest-environment node
// 純文字比對，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { blockOf, read } from '../support/spec-source'

// issue #98 的方向 A「先量再改」：`/auth/guest` 的分段計時。
//
// 「preview 上真的量得到那幾個數字」只有 E2E 驗得到（要真的有 Vercel、真的有 Neon），
// 而 E2E 不在 TDD Develop 的 job 內執行。所以這裡與 guest-login-spec.test.ts 同樣比對
// spec 的原始碼本文，守住幾件在修法上最容易失手的事：
//   ① 剩下那幾段（建帳號 / Neon 連線建立 / Vercel 冷啟）各自對應的 metric 都還在被斷言
//   ② 沒有退化成「只確認 header 存在」——那樣少量一段也照樣綠
//   ③ 沒有偷偷加上時間上限：訂一個猜來的門檻只會讓 E2E 在 preview 慢的那天無謂變紅
//   ④ issue #144 的驗收條件還在被驗：複製的那幾段**不該出現**在這次請求裡
//
// 守不住的是「斷言本身對不對」，那由 Vercel preview 上的 `pnpm test:e2e` 收尾
// （與 auth-wiring.test.ts 同樣的分工）。

const TIMING_SPEC = 'tests/e2e/guest-login-timing.spec.ts'

// Given /auth/guest 已經帶上分段計時 / When 在 preview 上跑 E2E
// Then 三個猜測各自的數字都量得到
describe('guest-login-timing.spec.ts 存在且真的斷言到那些分段', () => {
  it('spec 檔在 tests/e2e/ 底下', () => {
    expect(existsSync(resolve(process.cwd(), TIMING_SPEC))).toBe(true)
  })

  // 少任何一個，下一次要再壓時間就少一個能看的數字。
  //
  // ⚠ #144 之後 `tx` / `tx.user` 不再出現在這條路徑上（複製與交易一起搬到了
  // POST /api/guest-sandbox），所以它們從「要量得到」變成下面那一段的「不該出現」。
  it.each([
    ['建帳號', 'user'],
    ['Neon 連線建立', 'connect'],
    ['Vercel 冷啟的開機時間', 'boot'],
    ['instance 的冷熱', 'instance'],
    ['整趟總計', 'total'],
  ])('斷言得到「%s」（%s）', (_label, metric) => {
    expect(read(TIMING_SPEC)).toContain(`'${metric}'`)
  })

  // issue #144 的驗收條件本文。這一條守的是「那條斷言沒有被刪掉」——
  // 刪掉之後，把 copyTemplateSandbox 加回登入路徑不會有任何測試轉紅，
  // 而使用者會安靜地退回「按下按鈕之後乾等十幾秒」。
  it.each([
    ['交易整體', 'tx'],
    ['讀模板', 'tx.sandbox.read'],
    ['逐缸複製', 'tx.sandbox.tank1'],
  ])('驗到「%s」（%s）不出現在登入這次請求裡', (_label, metric) => {
    expect(read(TIMING_SPEC)).toContain(`'${metric}'`)
  })

  it('那幾段是以 toBeUndefined 驗「不存在」，不是驗「存在」', () => {
    expect(read(TIMING_SPEC)).toContain('toBeUndefined')
  })

  // 「header 有沒有回」與「裡面分不分得開」是兩件事。退化成前者的話，
  // 實作把所有分段合成一個 total 也照樣綠，而那正好是這個 issue 要避免的結果。
  it('不是只確認 Server-Timing 存在，而是真的取出每一段的 dur', () => {
    expect(read(TIMING_SPEC)).toContain('dur=')
  })
})

// Given 方向 B / C / D 都還沒選 / Then spec 不預設任何效能目標
//
// 這一輪的產出是數據。先訂一個「connect 要小於幾秒」的門檻，等於在還沒有量測結果之前
// 就替人類決定了可接受的量級，而且它會在 preview 慢的那一天讓 E2E 紅得毫無資訊。
describe('計時的 spec 不順手訂效能目標', () => {
  it('沒有對任何一段設時間上限', () => {
    const source = read(TIMING_SPEC)

    expect(source).not.toContain('toBeLessThan')
    expect(source).not.toContain('toBeLessThanOrEqual')
  })

  // `waitForTimeout` 硬等在慢的時候一樣會爆、在快的時候白白浪費時間（#95 明令不准）
  it('沒有用 waitForTimeout 硬等', () => {
    expect(read(TIMING_SPEC)).not.toContain('waitForTimeout')
  })

  // 讀的是 handler 另外發的那個自訂標頭。`Server-Timing` 到不了 preview 的客戶端——
  // E2E 第一次在 CI 上跑時三條全部拿到 undefined，三次重試皆然（run 30809735121）。
  // 改回去的話 unit 這一側原本一句話都不會說，要等下一次 E2E 才發現又量不到了。
  it('讀的是 X-Guest-Timing，不是會被改寫的 Server-Timing', () => {
    const source = read(TIMING_SPEC)

    expect(source).toContain('headers()[\'x-guest-timing\']')
    expect(source).not.toContain('headers()[\'server-timing\']')
  })
})

// Given 這支 spec 量的就是登入那一次請求本身
// Then 它不能跟著轉址，也不能被自動登入的 fixture 接管
describe('量的是登入那一次請求本身', () => {
  // 跟著 302 轉過去之後，拿到的是首頁的回應——上面沒有這次登入的計時。
  it('不跟隨轉址，並確認停在 302', () => {
    const source = read(TIMING_SPEC)

    expect(source).toContain('maxRedirects: 0')
    expect(source).toContain('toBe(302)')
  })

  // Story ②「已有 session 就不再建沙盒」在數據上的樣子：那幾段整個不存在。
  // 改成「比較快」的話，preview 慢的時候會偶發失敗，而且第一次登入本來就可能剛好很快。
  it('「再次進站」比對的是那幾段不存在，而不是比較快', () => {
    const block = blockOf(TIMING_SPEC, '再次進站量不到建帳號的那幾段')

    expect(block).toContain('toBeUndefined()')
    expect(block.match(/toBeUndefined\(\)/g) ?? []).not.toHaveLength(0)
  })

  it('沒有被刪掉或跳過的 test', () => {
    const source = read(TIMING_SPEC)

    expect(source.match(/^test\(/gm) ?? []).toHaveLength(3)
    expect(source).not.toContain('test.skip')
    expect(source).not.toContain('test.only')
  })
})
