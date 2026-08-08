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
 * @param template 模板名下有幾個缸。0 ＝ 這個資料庫沒跑過 seed。
 * @param existing 這位使用者名下已經有幾個缸。
 */
function fakeClient({ claimed = 1, template = 1, existing = 0 } = {}) {
  /** 依實際呼叫順序記下來——claim 與複製的先後、以及有沒有包在一起，是這支函式的重點 */
  const calls: string[] = []

  const ops = (owner: 'tx' | 'client') => ({
    user: {
      updateMany: vi.fn(async () => {
        calls.push(`${owner}.user.updateMany`)

        return { count: claimed }
      }),
    },
    tank: {
      count: vi.fn(async () => {
        calls.push(`${owner}.tank.count`)

        return existing
      }),
      findMany: vi.fn(async () => {
        calls.push(`${owner}.tank.findMany`)

        return Array.from({ length: template }, () => TEMPLATE_TANK)
      }),
      create: vi.fn(async () => {
        calls.push(`${owner}.tank.create`)

        return { id: 'guest-tank-1' }
      }),
    },
  })

  // ⚠ tx 與 client 刻意是**不同的物件**。
  //
  // 兩者傳同一個的話，「把複製移到交易外面」這個 mutation 完全隱形：$transaction 仍然
  // 被呼叫一次、呼叫順序一模一樣、錯誤照樣傳出去，三條測試全綠。而在真的 Postgres 上
  // 那會讓 claim 與複製各自獨立提交，這支函式整篇論證的原子性全部消失。
  // 分開之後，下面的 `calls` 會直接說出每一句到底落在誰身上。
  const tx = ops('tx')
  const client = {
    ...ops('client'),
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => {
      calls.push('$transaction')

      return run(tx)
    }),
  }

  return { client: client as unknown as PrismaClient & typeof client, tx, calls }
}

/** claim 那一句收到的參數 */
function claimArgs(tx: ReturnType<typeof fakeClient>['tx']) {
  const [args] = tx.user.updateMany.mock.calls[0] as unknown as [{
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
    const { client, tx } = fakeClient()

    await expect(ensureGuestSandbox(client, 'guest-user-1')).resolves.toEqual({
      copied: 1,
      alreadySeeded: false,
    })

    const [findArgs] = tx.tank.findMany.mock.calls[0] as unknown as [{ where: { userId: string } }]
    const [createArgs] = tx.tank.create.mock.calls[0] as unknown as [{ data: { userId: string } }]

    expect(findArgs.where.userId).toBe(TEMPLATE_USER.id)
    expect(createArgs.data.userId).toBe('guest-user-1')
  })

  // claim 的 where 一定要同時帶 id 與「sandboxSeededAt 還是 null」。
  //
  // 少了 id ＝ 改到所有人的資料。少了 null 那一條，這句 update 就永遠成功，
  // 冪等鎖整個失效——連點兩下會複製兩份，而畫面上看起來只是缸突然變兩倍。
  it('claim 同時以 id 與「還沒備妥」為條件', async () => {
    const { client, tx } = fakeClient()
    const before = Date.now()

    await ensureGuestSandbox(client, 'guest-user-1')

    expect(claimArgs(tx).where).toEqual({ id: 'guest-user-1', sandboxSeededAt: null })

    // 不只驗型別：寫進去的要是「現在」。這一欄的用途之一是找出卡在半路的使用者
    // （schema.prisma 的欄位註解），填一個固定值等於把那個用途拿掉，而型別檢查看不出來
    const claimedAt = claimArgs(tx).data.sandboxSeededAt

    expect(claimedAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(claimedAt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  // claim 必須排在複製**之前**：反過來的話，兩個併發請求會雙雙讀到 null、雙雙複製，
  // 等到要寫狀態時才發現撞在一起——那時候資料已經進去了。
  // ⚠ 這一條驗的是「每一句都落在 tx 上」，不只是順序。
  //
  // 把 copyTemplateSandbox(tx, …) 改成 copyTemplateSandbox(client, …)，複製整段就會跑在
  // 交易外面、與 claim 各自獨立提交——而順序看起來一模一樣。假 client 若把 tx 與 client
  // 當同一個物件，這個 mutation 一條測試都不會轉紅（見 fakeClient 的註解）。
  it('claim 與複製都落在交易的 tx 上，claim 在前', async () => {
    const { client, calls } = fakeClient()

    await ensureGuestSandbox(client, 'guest-user-1')

    expect(client.$transaction).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([
      '$transaction',
      'tx.user.updateMany',
      'tx.tank.count',
      'tx.tank.findMany',
      'tx.tank.create',
    ])
    // 外層那個 client 上一句都沒有
    expect(client.tank.create).not.toHaveBeenCalled()
    expect(client.tank.findMany).not.toHaveBeenCalled()
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

    // 貼著實際值而不是「比預設大就好」：`timeout: 5_001` 也能通過 `> 5_000`，
    // 而那會讓一件實測 11.5 秒的事跑在 5.001 秒的上限下，必然 P2028
    expect(options?.timeout).toBeGreaterThanOrEqual(30_000)
    expect(options?.maxWait).toBeGreaterThanOrEqual(10_000)
  })
})

// Given 我的沙盒已經備妥（或另一個分頁剛剛搶先複製完）
// When  這支函式再被呼叫
// Then  不複製第二份
describe('ensureGuestSandbox — 已經備妥', () => {
  it('claim 搶不到就什麼都不做', async () => {
    const { client, tx } = fakeClient({ claimed: 0 })

    await expect(ensureGuestSandbox(client, 'guest-user-1')).resolves.toEqual({
      copied: 0,
      alreadySeeded: true,
    })

    // 連模板都不讀：那一次 findMany 本身就是 3 秒（#144 量到的），
    // 而且讀了也只是為了接著寫一份不該存在的複本
    expect(tx.tank.findMany).not.toHaveBeenCalled()
    expect(tx.tank.create).not.toHaveBeenCalled()
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
        count: vi.fn().mockResolvedValue(0),
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
    const { client, tx } = fakeClient()
    const boom = new Error('transaction timed out')

    tx.tank.create.mockRejectedValueOnce(boom)

    await expect(ensureGuestSandbox(client, 'guest-user-1')).rejects.toBe(boom)
  })

  // 失敗那一次最需要數據——複製逾時的時候，人要知道它卡在哪一段。
  // 分段與 #98 的計時器共用同一套名稱（tx.sandbox.*），搬了家之後仍然對得起來。
  it('已經量到的段落在失敗後仍然留著', async () => {
    const { client, tx } = fakeClient()
    const timer = createTimer()

    tx.tank.create.mockRejectedValueOnce(new Error('boom'))

    await expect(ensureGuestSandbox(client, 'guest-user-1', timer)).rejects.toThrow()

    expect(timer.segments().map(segment => segment.name))
      .toEqual(expect.arrayContaining(['tx.sandbox.read', 'tx.sandbox.tank1']))
  })

  it('不傳計時器也照常運作', async () => {
    const { client } = fakeClient()

    await expect(ensureGuestSandbox(client, 'guest-user-1')).resolves.toMatchObject({ copied: 1 })
  })
})

// Given 模板名下一個缸都沒有（資料庫沒跑過 seed，或示範資料掛在改名前的舊使用者名下）
// When  補建被呼叫
// Then  claim 不能留下——否則這位使用者永遠拿不到沙盒
//
// copyTemplateSandbox 對空模板是回 0 而不是拋錯（訪客照樣要進得去），所以交易會
// **正常提交**，sandboxSeededAt 被填上，claim 再也搶不到。之後人類跑了 `pnpm db:seed`
// 也救不回來。#78 已經真的發生過一次「模板名下沒有缸」，當時的徵兆同樣只有畫面是空的。
describe('ensureGuestSandbox — 模板是空的', () => {
  it('回報「還欠著」而不是「已備妥」', async () => {
    const { client } = fakeClient({ template: 0 })

    await expect(ensureGuestSandbox(client, 'guest-user-1')).resolves.toEqual({
      copied: 0,
      alreadySeeded: false,
    })
  })

  // 「交易有回滾」在假 client 上看不到，但看得到它是**怎麼**回滾的：
  // Prisma 的互動式交易只認得「callback 拋錯」這一種取消方式。
  it('讓交易以拋錯的方式回滾，而不是正常回傳', async () => {
    const { client } = fakeClient({ template: 0 })

    await ensureGuestSandbox(client, 'guest-user-1')

    await expect(client.$transaction.mock.results[0]!.value).rejects.toThrow()
  })

  // 錯誤不能傳到呼叫端：使用者要看到的是空狀態，不是一頁 500
  it('不把那個錯誤丟給呼叫端', async () => {
    const { client } = fakeClient({ template: 0 })

    await expect(ensureGuestSandbox(client, 'guest-user-1')).resolves.toBeDefined()
  })
})

// Given 這位使用者名下已經有缸，但 sandboxSeededAt 還是 null
// When  補建被呼叫
// Then  只補標記，不再複製一份
//
// 這是 migration 回填的第二道防線。回填只涵蓋「執行當下已存在的列」，而
// `prisma migrate deploy` 跑在 build 開始時、新的 bundle 要等 build 跑完才服務流量：
// 那幾分鐘內由舊程式碼建立的訪客會帶著完整的沙盒而欄位是 null。
// 少了這一條，他之後只要看到一次空清單就會被複製第二份，缸與生物直接變兩倍。
describe('ensureGuestSandbox — 已經有缸但沒被標記過', () => {
  it('不再複製一份', async () => {
    const { client, tx } = fakeClient({ existing: 3 })

    await expect(ensureGuestSandbox(client, 'guest-user-1')).resolves.toEqual({
      copied: 0,
      alreadySeeded: true,
    })

    expect(tx.tank.findMany).not.toHaveBeenCalled()
    expect(tx.tank.create).not.toHaveBeenCalled()
  })

  // 標記要留下來（交易正常提交），下次進站才不會再走一遍這條路
  it('claim 留著，不回滾', async () => {
    const { client } = fakeClient({ existing: 3 })

    await ensureGuestSandbox(client, 'guest-user-1')

    await expect(client.$transaction.mock.results[0]!.value).resolves.toBeDefined()
  })

  // 只看自己名下的缸，不是全表
  it('只數這位使用者名下的缸', async () => {
    const { client, tx } = fakeClient({ existing: 1 })

    await ensureGuestSandbox(client, 'guest-user-1')

    const [args] = tx.tank.count.mock.calls[0] as unknown as [{ where: { userId: string } }]

    expect(args.where).toEqual({ userId: 'guest-user-1' })
  })
})
