// @vitest-environment node
// 純函式測試，不碰 Vue 元件、Nuxt composable 或 DOM；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it } from 'vitest'
import {
  createInstanceProbe,
  createTimer,
  formatServerTiming,
  formatTimingLog,
} from '../../../server/utils/requestTiming'

// issue #98 的方向 A「先量再改」。
//
// preview 上 `/auth/guest` 這一次請求要 9.4～14.8 秒，而現在沒有任何數據能分辨那 10 秒
// 是花在「交易本身太重」、「Neon 連線建立」還是「Vercel 冷啟」——B（減少往返）、
// C（縮小模板）、D（先進站後複製）挑錯了就是白改。這支模組就是那把尺。
//
// 時鐘一律由呼叫端注入：真的去睡 10 毫秒的測試又慢又會偶發失敗，
// 而這裡要驗的是「有沒有把該量的量到、格式對不對」，不是 performance.now() 準不準。

/** 可控時鐘：測試自己決定時間往前走多少 */
function stopwatch(start = 0) {
  let value = start

  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms
    },
  }
}

// ── createTimer ──

// Given 一次 /auth/guest 請求 / When 它走完各個階段
// Then 每一段各自的耗時都被記下來，而且看得出先後
describe('createTimer — 分段計時', () => {
  it('measure 原樣回傳 run 的結果', async () => {
    const clock = stopwatch()
    const timer = createTimer(clock.now)

    await expect(timer.measure('connect', async () => 'connected')).resolves.toBe('connected')
  })

  it('記下每一段的耗時', async () => {
    const clock = stopwatch()
    const timer = createTimer(clock.now)

    await timer.measure('connect', async () => clock.advance(3400))
    await timer.measure('tx', async () => clock.advance(5900))

    expect(timer.segments()).toEqual([
      { name: 'connect', ms: 3400 },
      { name: 'tx', ms: 5900 },
    ])
  })

  // 巢狀是這支模組的重點：`tx` 與它底下的 `tx.sandbox` 必須同時看得到，
  // 才分得出「交易整體慢」與「慢在複製沙盒那一段」。
  // 依「開始」的順序排，父段落才會排在自己的子段落前面。
  it('巢狀段落一起記下，父段落排在子段落前面', async () => {
    const clock = stopwatch()
    const timer = createTimer(clock.now)

    await timer.measure('tx', async () => {
      await timer.measure('tx.user', async () => clock.advance(200))
      await timer.measure('tx.sandbox', async () => clock.advance(5700))
    })

    expect(timer.segments()).toEqual([
      { name: 'tx', ms: 5900 },
      { name: 'tx.user', ms: 200 },
      { name: 'tx.sandbox', ms: 5700 },
    ])
  })

  // 最需要數據的正是失敗那一次（交易逾時、連不上 Neon）。
  // 量到一半就把段落丟掉的話，log 裡剩下的只有一個沒有上下文的錯誤。
  it('run 拋錯時仍記下該段落的耗時，錯誤原樣往外拋', async () => {
    const clock = stopwatch()
    const timer = createTimer(clock.now)
    const boom = new Error('transaction timed out')

    await expect(timer.measure('tx', async () => {
      clock.advance(30_000)

      throw boom
    })).rejects.toBe(boom)

    expect(timer.segments()).toEqual([{ name: 'tx', ms: 30_000 }])
  })

  // total 不是各段落相加：段落之間的空檔（沒被量到的那些）正是「還有哪裡沒量」的線索。
  it('totalMs 從建立時起算，涵蓋沒有被 measure 到的空檔', async () => {
    const clock = stopwatch()
    const timer = createTimer(clock.now)

    clock.advance(100)
    await timer.measure('connect', async () => clock.advance(300))
    clock.advance(50)

    expect(timer.totalMs()).toBe(450)
  })

  // 回傳的是複本：呼叫端（格式化、log）不該有辦法改到計時器自己記的東西
  it('segments() 回傳的是複本，改不到計時器內部', async () => {
    const clock = stopwatch()
    const timer = createTimer(clock.now)

    await timer.measure('connect', async () => clock.advance(10))
    timer.segments()[0]!.ms = 999

    expect(timer.segments()).toEqual([{ name: 'connect', ms: 10 }])
  })
})

// ── createInstanceProbe ──

// Given 這次請求落在一個剛開機的 Vercel instance / When 走完 /auth/guest
// Then log 分得出「這次是冷啟」，之後同一個 instance 的請求則不是
describe('createInstanceProbe — 冷啟', () => {
  it('第一次請求是冷啟，之後同一個 instance 的都不是', () => {
    const probe = createInstanceProbe(stopwatch().now, () => 0)

    expect(probe().cold).toBe(true)
    expect(probe().cold).toBe(false)
    expect(probe().cold).toBe(false)
  })

  // 模組載入之前的那一段（Node 開機、載 bundle）不在任何一個 measure 裡面，
  // 只有 process 自己的 uptime 講得出來——冷啟的成本大半在這裡。
  it('bootMs 取模組載入當下的 process uptime，之後不再變動', () => {
    const clock = stopwatch()
    let uptime = 210

    const probe = createInstanceProbe(clock.now, () => uptime)

    uptime = 99_999
    clock.advance(5_000)

    expect(probe().bootMs).toBe(210)
    expect(probe().bootMs).toBe(210)
  })

  it('ageMs 是模組載入到這次請求之間的間隔', () => {
    const clock = stopwatch()
    const probe = createInstanceProbe(clock.now, () => 0)

    clock.advance(8)
    expect(probe().ageMs).toBe(8)

    clock.advance(60_000)
    expect(probe().ageMs).toBe(60_008)
  })
})

// ── 格式 ──

/** 一組量完的數據，給兩支格式化函式共用 */
async function measured() {
  const clock = stopwatch()
  const timer = createTimer(clock.now)

  clock.advance(2)
  await timer.measure('session.read', async () => clock.advance(6))
  await timer.measure('connect', async () => clock.advance(3400))

  return timer
}

const COLD = { cold: true, bootMs: 210, ageMs: 5 }
const WARM = { cold: false, bootMs: 210, ageMs: 60_000 }

// Then 那一行讀得懂、grep 得到，一眼看得出時間花在哪一段
describe('formatTimingLog', () => {
  it('一行文字帶著總計、冷啟狀態與每一個段落', async () => {
    expect(formatTimingLog('[auth] 訪客登入計時', await measured(), COLD, { newGuest: true }))
      .toBe('[auth] 訪客登入計時 total=3408ms cold=true boot=210ms age=5ms newGuest=true'
        + ' session.read=6ms connect=3400ms')
  })

  it('沒有額外欄位時照樣成立', async () => {
    expect(formatTimingLog('[auth] 訪客登入失敗', await measured(), WARM))
      .toBe('[auth] 訪客登入失敗 total=3408ms cold=false boot=210ms age=60000ms'
        + ' session.read=6ms connect=3400ms')
  })
})

// preview 上要拿到這些數字，總不能每次都去翻 Vercel 的 runtime log——#95 量那五次
// 用的就是 Playwright。Server-Timing 讓同一份數據直接落在回應上（瀏覽器 devtools 的
// Network 面板也讀得到），量測的成本因此跟按一次按鈕一樣低。
describe('formatServerTiming', () => {
  it('輸出合法的 Server-Timing：總計、開機、instance 冷熱與每一個段落', async () => {
    expect(formatServerTiming(await measured(), COLD))
      .toBe('total;dur=3408, boot;dur=210, instance;dur=5;desc="cold",'
        + ' session.read;dur=6, connect;dur=3400')
  })

  it('不是冷啟時 instance 標成 warm', async () => {
    expect(formatServerTiming(await measured(), WARM)).toContain('instance;dur=60000;desc="warm"')
  })
})
