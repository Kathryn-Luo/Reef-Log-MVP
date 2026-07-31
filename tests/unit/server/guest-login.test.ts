// @vitest-environment node
// 純函式測試，不碰 Vue 元件、Nuxt composable 或 DOM；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, User } from '@prisma/client'
import { TEMPLATE_USER } from '../../../prisma/seedUser'
import { GUEST_DISPLAY_NAME, createGuestAccountId, resolveGuestLogin } from '../../../server/utils/guestLogin'

// 訪客登入的「查／建帳號 + 建沙盒」（issue #66）。
//
// 每位訪客一個獨立帳號（Epic #47 第 6 節定案），所以這裡沒有任何「共用訪客」的路徑：
// 沒有 session 就是建一位新的 User，而不是去找一位既有的訪客沿用。
//
// 這個 job 連不到資料庫，Prisma Client 一律以假物件替身餵入。
// $transaction 的替身直接把同一個假 client 當成 tx 傳回去——要驗的是「有沒有包在一起」，
// 不是 Prisma 自己的交易語意。

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

function fakeClient() {
  /** 依實際呼叫順序記下來——「建帳號」與「複製沙盒」的先後與包裹關係是這支函式的重點 */
  const calls: string[] = []
  let users = 0
  let tanks = 0

  const client = {
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => {
      calls.push('$transaction')

      return run(client)
    }),
    user: {
      create: vi.fn(async () => {
        calls.push('user.create')

        return { id: `guest-user-${++users}` }
      }),
      findUnique: vi.fn(),
    },
    account: { create: vi.fn(), findUnique: vi.fn() },
    tank: {
      findMany: vi.fn().mockResolvedValue([TEMPLATE_TANK]),
      create: vi.fn(async () => {
        calls.push('tank.create')

        return { id: `guest-tank-${++tanks}` }
      }),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    },
    waterLog: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    creature: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    maintenanceTask: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  }

  return { client: client as unknown as PrismaClient & typeof client, calls }
}

interface CreatedUser {
  email: string | null
  displayName: string | null
  accounts: { create: { provider: string, providerAccountId: string } }
}

/** 第 n 次 user.create 收到的 data */
function createdUser(client: ReturnType<typeof fakeClient>['client'], index = 0): CreatedUser {
  const [args] = client.user.create.mock.calls[index] as unknown as [{ data: CreatedUser }]

  return args.data
}

// Given 我從未以訪客身分進站（沒有 session cookie）/ When 我按下「以訪客身分瀏覽」
describe('resolveGuestLogin — 首次進站', () => {
  // Then 系統建立一位新的 User（email 為 null、displayName 為「訪客」）
  it('建立一位新的 User，email 為 null、displayName 為「訪客」', async () => {
    const { client } = fakeClient()

    await expect(resolveGuestLogin(client, null)).resolves.toEqual({
      userId: 'guest-user-1',
      isNewGuest: true,
    })

    expect(client.user.create).toHaveBeenCalledTimes(1)
    expect(createdUser(client)).toMatchObject({
      email: null,
      displayName: '訪客',
    })
    expect(GUEST_DISPLAY_NAME).toBe('訪客')
  })

  // And 建立一列 Account（provider = GUEST、providerAccountId 為隨機 id）
  //
  // 與 Google 登入同樣走 nested create：分兩次寫的話，中間失敗會留下一位沒有任何
  // Account、因此永遠對不回來的孤兒 User。
  it('同一次寫入建立 Account，provider 為 GUEST、providerAccountId 為隨機 id', async () => {
    const { client } = fakeClient()

    await resolveGuestLogin(client, null)

    const { accounts } = createdUser(client)

    expect(accounts.create.provider).toBe('GUEST')
    expect(accounts.create.providerAccountId).toEqual(expect.any(String))
    expect(accounts.create.providerAccountId.length).toBeGreaterThanOrEqual(16)
    // 不是分兩次寫
    expect(client.account.create).not.toHaveBeenCalled()
  })

  // 「訪客」不是一個共用帳號：不會有一個所有人都撞得到的固定 providerAccountId。
  // 固定值等於退回 PR #60 最初的共用帳號設計（issue 的「非目標」第一條）。
  it('providerAccountId 每位訪客都不同', async () => {
    const { client } = fakeClient()

    await resolveGuestLogin(client, null)
    await resolveGuestLogin(client, null)

    expect(createdUser(client, 0).accounts.create.providerAccountId)
      .not.toBe(createdUser(client, 1).accounts.create.providerAccountId)
  })

  it('createGuestAccountId 每次都給出不同的隨機 id', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createGuestAccountId()))

    expect(ids.size).toBe(50)
  })

  // And 把示範資料模板的內容複製一份掛在我名下
  it('複製模板資料，掛在新建的這一位名下', async () => {
    const { client } = fakeClient()

    await resolveGuestLogin(client, null)

    const [findArgs] = client.tank.findMany.mock.calls[0] as unknown as [{ where: { userId: string } }]
    const [createArgs] = client.tank.create.mock.calls[0] as unknown as [{ data: { userId: string } }]

    expect(findArgs.where.userId).toBe(TEMPLATE_USER.id)
    expect(createArgs.data.userId).toBe('guest-user-1')
  })

  // 建帳號與複製沙盒之間失敗的話，訪客會拿到一個半份資料的沙盒，而且因為 User 已經存在，
  // 之後再進站也不會補完（Story ② 不重複複製）。兩件事因此必須一起成立或一起不成立。
  it('建帳號與複製沙盒包在同一個交易裡', async () => {
    const { client, calls } = fakeClient()

    await resolveGuestLogin(client, null)

    expect(client.$transaction).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['$transaction', 'user.create', 'tank.create'])
  })

  // Prisma 互動式交易有兩個上限，兩個都要放寬：
  //   timeout —— 交易本身能跑多久（預設 5 秒）。要跑的是「模板有幾個缸就幾句 nested
  //              create」，每一句底下數十筆 insert。
  //   maxWait —— 等一條可用連線的上限（預設 2 秒）。Neon 是 serverless，連線吃緊時
  //              光是拿到連線就可能超過 2 秒。
  //
  // 只放寬 timeout 會留下一個很難查的故障：交易根本還沒開始就失敗了，而錯誤訊息談的
  // 是交易。訪客這條路徑一位訪客只走一次，失敗就沒有第二次機會（下次進站是新沙盒）。
  it('交易的 timeout 與 maxWait 都放寬，不留下預設值', async () => {
    const { client } = fakeClient()

    await resolveGuestLogin(client, null)

    const [, options] = client.$transaction.mock.calls[0] as unknown as [
      unknown,
      { timeout?: number, maxWait?: number } | undefined,
    ]

    expect(options?.timeout).toBeGreaterThan(5_000)
    expect(options?.maxWait).toBeGreaterThan(2_000)
  })
})

// Given 我已有訪客 session / When 我再次進站
describe('resolveGuestLogin — 已有 session', () => {
  const EXISTING = { id: 'guest-user-existing', email: null, displayName: '訪客' } as User

  // Then 沿用同一位訪客 User
  it('沿用 session 裡那一位，不再建一位', async () => {
    const { client } = fakeClient()

    await expect(resolveGuestLogin(client, EXISTING)).resolves.toEqual({
      userId: 'guest-user-existing',
      isNewGuest: false,
    })

    expect(client.user.create).not.toHaveBeenCalled()
  })

  // And 不會再建一個沙盒，也不會重複複製示範資料
  it('不再建一個沙盒，也不重複複製示範資料', async () => {
    const { client } = fakeClient()

    await resolveGuestLogin(client, EXISTING)

    expect(client.tank.findMany).not.toHaveBeenCalled()
    expect(client.tank.create).not.toHaveBeenCalled()
    expect(client.$transaction).not.toHaveBeenCalled()
  })
})

// Given 訪客 A 與訪客 B 同時以訪客身分瀏覽 / Then A 與 B 各自看到自己的資料
//
// 資料歸屬的實際隔離由既有的授權路徑（缸掛在 User 之下、handler 一律以當前 userId 查）
// 提供，這裡守的是它的前提：兩位訪客拿到的是兩位不同的 User 與兩份不同的缸。
describe('resolveGuestLogin — 兩位訪客互不干擾', () => {
  it('兩位訪客拿到不同的 userId，缸各自掛在自己名下', async () => {
    const { client } = fakeClient()

    const first = await resolveGuestLogin(client, null)
    const second = await resolveGuestLogin(client, null)

    expect(first.userId).not.toBe(second.userId)

    const [firstTank, secondTank] = client.tank.create.mock.calls as unknown as Array<
      [{ data: { userId: string } }]
    >

    expect(firstTank![0].data.userId).toBe(first.userId)
    expect(secondTank![0].data.userId).toBe(second.userId)
  })

  // 訪客的資料一定是自己的那一份：沒有任何一列會掛回模板使用者，
  // 否則訪客 A 的修改會直接改到之後每一位訪客的示範資料（Story ④）。
  it('沒有任何一位訪客的資料掛在模板使用者名下', async () => {
    const { client } = fakeClient()

    await resolveGuestLogin(client, null)
    await resolveGuestLogin(client, null)

    for (const [args] of client.tank.create.mock.calls as unknown as Array<
      [{ data: { userId: string } }]
    >) {
      expect(args.data.userId).not.toBe(TEMPLATE_USER.id)
    }
  })
})
