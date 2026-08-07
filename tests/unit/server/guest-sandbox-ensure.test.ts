// @vitest-environment node
// 純函式測試，不碰 Vue 元件、Nuxt composable 或 DOM；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { TEMPLATE_USER } from '../../../prisma/seedUser'
import { ensureGuestSandbox } from '../../../server/utils/guestSandbox'
import { createTimer } from '../../../server/utils/requestTiming'

// 「補上這位使用者欠著的沙盒」（issue #144）。
//
// #66 當初把複製放在 /auth/guest 裡，與建帳號同一個交易。實測那一段要 11.5 秒，
// 佔整次請求的 78%，而 302 是 handler 最後一行才發的——訪客因此在登入頁前面乾等十幾秒。
// #144 把複製搬到這支函式，由首頁在使用者已經看得到畫面之後才呼叫。
//
// 搬家會弄丟一個保證：原本「建帳號」與「複製沙盒」在同一個交易裡，要嘛都成立、要嘛都不成立。
// 這支函式用另一個方式把它拿回來——**claim 與複製包在同一個交易裡**：
//   - claim ＝ `updateMany({ where: { sandboxSeededAt: null } })`，搶得到才複製
//   - 複製失敗 → 整個交易回滾 → claim 一起消失 → 下次進站會再試一次
//   - 併發的第二次 → 卡在同一列的 row lock 上，等第一次提交後 where 不再成立 → 0 筆 → 不複製
//
// 這三件事就是下面三個 describe。

const TEMPLATE_TANK = {
  id: 'seed-tank-main',
  userId: TEMPLATE_USER.id,
  name: '主缸',
  createdAt: new Date('2026-07-01T00:00:00Z'),
  updatedAt: new Date('2026-07-01T00:00:00Z'),
  waterLogs: [],
  waterTargets: [],
  creatures: [],
  maintenanceTasks: [],
}

/**
 * @param claimed claim 那一句 updateMany 會回報改到幾列。
 *   1 ＝ 這次搶到了（原本是 null）；0 ＝ 別人先搶走，或本來就已經備妥。
 */
function fakeClient(claimed = 1) {
  /** 依實際呼叫順序記下來——claim 與複製的先後、以及有沒有包在一起，是這支函式的重點 */
  const calls: string[] = []

  const client = {
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => {
      calls.push('$transaction')

      return run(client)
    }),
    user: {
      updateMany: vi.fn(async () => {
        calls.push('user.updateMany')

        return { count: claimed }
      }),
    },
    tank: {
      findMany: vi.fn(async () => {
        calls.push('tank.findMany')

        return [TEMPLATE_TANK]
      }),
      create: vi.fn(async () => {
        calls.push('tank.create')

        return { id: 'guest-tank-1' }
      }),
    },
  }

  return { client: client as unknown as PrismaClient & typeof client, calls }
}

/** claim 那一句收到的參數 */
function claimArgs(client: ReturnType<typeof fakeClient>['client']) {
  const [args] = client.user.updateMany.mock.calls[0] as unknown as [{
    where: { id: string, sandboxSeededAt: null }
    data: { sandboxSeededAt: Date }
  }]

  return args
}

// Given 我是剛建好帳號、沙盒還沒複製的訪客
// When  首頁呼叫這支函式
// Then  示範資料被複製到我名下，狀態標記為已備妥
describe('ensureGuestSandbox — 還欠一份沙盒', () => {
  it('複製模板資料，回報複製了幾個缸', async () => {
    const { client } = fakeClient()

    await expect(ensureGuestSandbox(client, 'guest-user-1')).resolves.toEqual({
      copied: 1,
      alreadySeeded: false,
    })

    const [findArgs] = client.tank.findMany.mock.calls[0] as unknown as [{ where: { userId: string } }]
    const [createArgs] = client.tank.create.mock.calls[0] as unknown as [{ data: { userId: string } }]

    expect(findArgs.where.userId).toBe(TEMPLATE_USER.id)
    expect(createArgs.data.userId).toBe('guest-user-1')
  })

  // claim 的 where 一定要同時帶 id 與「sandboxSeededAt 還是 null」。
  //
  // 少了 id ＝ 改到所有人的資料。少了 null 那一條，這句 update 就永遠成功，
  // 冪等鎖整個失效——連點兩下會複製兩份，而畫面上看起來只是缸突然變兩倍。
  it('claim 同時以 id 與「還沒備妥」為條件', async () => {
    const { client } = fakeClient()

    await ensureGuestSandbox(client, 'guest-user-1')

    expect(claimArgs(client).where).toEqual({ id: 'guest-user-1', sandboxSeededAt: null })
    expect(claimArgs(client).data.sandboxSeededAt).toBeInstanceOf(Date)
  })

  // claim 必須排在複製**之前**：反過來的話，兩個併發請求會雙雙讀到 null、雙雙複製，
  // 等到要寫狀態時才發現撞在一起——那時候資料已經進去了。
  it('claim 與複製包在同一個交易裡，claim 在前', async () => {
    const { client, calls } = fakeClient()

    await ensureGuestSandbox(client, 'guest-user-1')

    expect(client.$transaction).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['$transaction', 'user.updateMany', 'tank.findMany', 'tank.create'])
  })

  // 與 #66 當初在 resolveGuestLogin 上放寬的是同兩個上限，理由也一樣：
  // 要跑的仍然是「模板有幾個缸就幾句 nested create」，而 Neon 是 serverless。
  // 搬了家不代表工作量變小了——留著預設值的話，這支函式會用 5 秒去做一件要 11 秒的事。
  it('交易的 timeout 與 maxWait 都放寬，不留下預設值', async () => {
    const { client } = fakeClient()

    await ensureGuestSandbox(client, 'guest-user-1')

    const [, options] = client.$transaction.mock.calls[0] as unknown as [
      unknown,
      { timeout?: number, maxWait?: number } | undefined,
    ]

    expect(options?.timeout).toBeGreaterThan(5_000)
    expect(options?.maxWait).toBeGreaterThan(2_000)
  })
})

// Given 我的沙盒已經備妥（或另一個分頁剛剛搶先複製完）
// When  這支函式再被呼叫
// Then  不複製第二份
describe('ensureGuestSandbox — 已經備妥', () => {
  it('claim 搶不到就什麼都不做', async () => {
    const { client } = fakeClient(0)

    await expect(ensureGuestSandbox(client, 'guest-user-1')).resolves.toEqual({
      copied: 0,
      alreadySeeded: true,
    })

    // 連模板都不讀：那一次 findMany 本身就是 3 秒（#144 量到的），
    // 而且讀了也只是為了接著寫一份不該存在的複本
    expect(client.tank.findMany).not.toHaveBeenCalled()
    expect(client.tank.create).not.toHaveBeenCalled()
  })

  // 重新整理、兩個分頁、連點兩下都會打到這裡。
  // 第二次之後一律是「已經備妥」，不會累積出第二、第三份示範資料。
  it('連續呼叫三次只複製一份', async () => {
    let seeded = false

    const client = {
      $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(client)),
      user: {
        updateMany: vi.fn(async () => {
          const count = seeded ? 0 : 1

          seeded = true

          return { count }
        }),
      },
      tank: {
        findMany: vi.fn().mockResolvedValue([TEMPLATE_TANK]),
        create: vi.fn().mockResolvedValue({ id: 'guest-tank-1' }),
      },
    } as unknown as PrismaClient & { tank: { create: { mock: { calls: unknown[] } } } }

    const results = []

    for (let i = 0; i < 3; i++) {
      results.push(await ensureGuestSandbox(client, 'guest-user-1'))
    }

    expect(results.map(result => result.alreadySeeded)).toEqual([false, true, true])
    expect(client.tank.create.mock.calls).toHaveLength(1)
  })
})

// Given 複製到一半失敗（Neon 斷線、交易逾時）
// When  我重新進站
// Then  系統會再試一次，不會把我留在「有帳號、沒資料」的半路上
describe('ensureGuestSandbox — 複製失敗', () => {
  // 錯誤一定要往外拋，不能吞掉回一個 alreadySeeded: true。
  //
  // 吞掉的話交易會**提交**，claim 就留下了——這位訪客從此被標記成「沙盒已備妥」，
  // 而他名下一個缸都沒有，之後再也不會被補完。這正是 #144 要避免的「半個帳號」。
  it('錯誤往外拋，讓交易回滾、claim 跟著消失', async () => {
    const { client } = fakeClient()
    const boom = new Error('transaction timed out')

    client.tank.create.mockRejectedValueOnce(boom)

    await expect(ensureGuestSandbox(client, 'guest-user-1')).rejects.toBe(boom)
  })

  // 失敗那一次最需要數據——複製逾時的時候，人要知道它卡在哪一段。
  // 分段與 #98 的計時器共用同一套名稱（tx.sandbox.*），搬了家之後仍然對得起來。
  it('已經量到的段落在失敗後仍然留著', async () => {
    const { client } = fakeClient()
    const timer = createTimer()

    client.tank.create.mockRejectedValueOnce(new Error('boom'))

    await expect(ensureGuestSandbox(client, 'guest-user-1', timer)).rejects.toThrow()

    expect(timer.segments().map(segment => segment.name))
      .toEqual(expect.arrayContaining(['tx.sandbox.read', 'tx.sandbox.tank1']))
  })

  it('不傳計時器也照常運作', async () => {
    const { client } = fakeClient()

    await expect(ensureGuestSandbox(client, 'guest-user-1')).resolves.toMatchObject({ copied: 1 })
  })
})
