// @vitest-environment node
// 純函式測試，不碰 Vue 元件、Nuxt composable 或 DOM；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, User } from '@prisma/client'
import { TEMPLATE_USER } from '../../../prisma/seedUser'
import { GUEST_DISPLAY_NAME, createGuestAccountId, resolveGuestLogin } from '../../../server/utils/guestLogin'
import { createTimer } from '../../../server/utils/requestTiming'

// 訪客登入的「查／建帳號」（issue #66；複製沙盒那一半已於 #144 搬走）。
//
// 每位訪客一個獨立帳號（Epic #47 第 6 節定案），所以這裡沒有任何「共用訪客」的路徑：
// 沒有 session 就是建一位新的 User，而不是去找一位既有的訪客沿用。
//
// ⚠ #144：這支函式**不再複製示範資料**。那一段實測 11.5 秒、佔 /auth/guest 全部耗時的
// 78%，而 302 是 handler 最後一行才發的，訪客因此在登入頁前面乾等十幾秒。複製移到了
// server/utils/guestSandbox.ts 的 ensureGuestSandbox()，由首頁在畫面已經看得到之後才呼叫。
// 下面那一整個 describe（「不再複製沙盒」）守的就是它沒有被搬回來。
//
// 這個 job 連不到資料庫，Prisma Client 一律以假物件替身餵入。

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
    // issue #98：連線建立與交易要分開量，所以這條路徑上多了一次明確的 $connect
    $connect: vi.fn(async () => {
      calls.push('$connect')
    }),
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
  /** #144：新訪客欠著一份沙盒，所以這一欄刻意不被寫入（維持 null） */
  sandboxSeededAt?: Date
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

  // And 沙盒欄位維持 null —— 「這位使用者還欠一份沙盒」（issue #144）。
  //
  // 這是首頁唯一分得出「正在準備」與「真的沒有缸」的依據。這裡若順手填上時間，
  // 訪客會被判定成沙盒已備妥，然後停在一個永遠不會長出東西的空狀態上。
  it('不預先填上 sandboxSeededAt，新訪客欠著一份沙盒', async () => {
    const { client } = fakeClient()

    await resolveGuestLogin(client, null)

    expect(createdUser(client).sandboxSeededAt).toBeUndefined()
  })

  // issue #165 Story⑥「Given 我是訪客 / When 我進站 / Then googleAvatarUrl 維持 null」——
  // 訪客沒有 Google 頭像可拿。頭像的來源全部在 googleLogin.ts 那一側，這條路徑
  // 連 googleAvatarUrl 這個鍵都不該出現。
  it('不寫入 googleAvatarUrl，訪客沒有 Google 頭像', async () => {
    const { client } = fakeClient()

    await resolveGuestLogin(client, null)

    expect(createdUser(client)).not.toHaveProperty('googleAvatarUrl')
    expect(createdUser(client)).not.toHaveProperty('customAvatarUrl')
  })

  it('建帳號是單獨一次 nested create，不再需要交易', async () => {
    const { client, calls } = fakeClient()

    await resolveGuestLogin(client, null)

    // User 與 Account 的原子性由 nested create 自己提供（同一句 INSERT 鏈），
    // 交易原本是為了把複製沙盒一起包進來——那一段搬走之後就沒有第二件事要包了
    expect(client.$transaction).not.toHaveBeenCalled()
    expect(calls).toEqual(['$connect', 'user.create'])
  })
})

// #144 的核心：那 11.5 秒不能再回到這條路徑上。
//
// 這一整段是「搬走了就不要搬回來」的防線。少了它，把 copyTemplateSandbox 加回
// resolveGuestLogin 不會有任何一條測試轉紅，而使用者會安安靜靜地退回等十幾秒。
describe('resolveGuestLogin — 不再複製沙盒', () => {
  it('不讀模板、不建缸', async () => {
    const { client } = fakeClient()

    await resolveGuestLogin(client, null)

    expect(client.tank.findMany).not.toHaveBeenCalled()
    expect(client.tank.create).not.toHaveBeenCalled()
  })

  // 驗收條件本文：302 的 X-Guest-Timing 裡不再出現任何 tx.sandbox.* 段落。
  // E2E 在 preview 上驗同一件事，這裡先在 unit 這一層擋住。
  it('計時裡不留下任何 tx.sandbox.* 段落', async () => {
    const { client } = fakeClient()
    const timer = createTimer()

    await resolveGuestLogin(client, null, timer)

    expect(timer.segments().map(segment => segment.name).filter(name => name.startsWith('tx.sandbox')))
      .toEqual([])
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

  // And 不會再建一個沙盒
  it('不再建一個沙盒', async () => {
    const { client } = fakeClient()

    await resolveGuestLogin(client, EXISTING)

    expect(client.tank.findMany).not.toHaveBeenCalled()
    expect(client.tank.create).not.toHaveBeenCalled()
    expect(client.user.create).not.toHaveBeenCalled()
  })
})

// issue #98 的方向 A「先量再改」。
//
// preview 上 `/auth/guest` 這一次請求要 9.4～14.8 秒，而「交易太重」與「Neon 連線建立慢」
// 這兩個猜測，目前沒有任何數據分得開——B（減少往返）、C（縮小模板）挑錯了就是白改。
// 所以這條路徑上每一段都要各自量到。
describe('resolveGuestLogin — 分段計時', () => {
  /** 量到的段落名稱，依開始順序 */
  const names = (timer: ReturnType<typeof createTimer>) => timer.segments().map(segment => segment.name)

  // 連線建立要在寫入之前先做完。Prisma 預設是「第一次查詢時才連」，那樣 Neon 的
  // 握手時間會被算進建帳號那一段裡，量出來的就不是建帳號的成本。
  //
  // #144 之後這件事更要緊：`connect` 與 `user` 是這次請求剩下的**全部**，
  // 下一次要再壓時間就得從這兩個數字裡找。
  it('連線建立自己一段，而且排在建帳號之前', async () => {
    const { client, calls } = fakeClient()
    const timer = createTimer()

    await resolveGuestLogin(client, null, timer)

    expect(client.$connect).toHaveBeenCalledTimes(1)
    expect(names(timer).indexOf('connect')).toBeGreaterThan(-1)
    expect(names(timer).indexOf('connect')).toBeLessThan(names(timer).indexOf('user'))
    // 真的先連再寫，不只是段落的排序好看
    expect(calls.indexOf('$connect')).toBeLessThan(calls.indexOf('user.create'))
  })

  it('建帳號自己一段', async () => {
    const { client } = fakeClient()
    const timer = createTimer()

    await resolveGuestLogin(client, null, timer)

    expect(names(timer)).toEqual(['connect', 'user'])
  })

  // 失敗那一次最需要數據——卡住的時候，人要知道它是卡在哪一段。
  it('寫入失敗時，已經量到的段落仍然留著', async () => {
    const { client } = fakeClient()
    const boom = new Error('write timed out')

    client.user.create.mockRejectedValueOnce(boom)

    const timer = createTimer()

    await expect(resolveGuestLogin(client, null, timer)).rejects.toBe(boom)
    // 連拋錯的那一段自己都留著耗時——「卡在哪裡才失敗的」正是要看這個
    expect(names(timer)).toEqual(expect.arrayContaining(['connect', 'user']))
  })

  // Story ②：已經有身分時這支函式一次資料庫都不碰，所以也沒有任何段落可量。
  // 有段落就代表它又去連了一次資料庫。
  it('已有 session 時不連線、不留下任何段落', async () => {
    const { client } = fakeClient()
    const timer = createTimer()

    await resolveGuestLogin(client, { id: 'guest-user-existing' } as User, timer)

    expect(client.$connect).not.toHaveBeenCalled()
    expect(timer.segments()).toEqual([])
  })

  // 計時是附加的，不是必要參數：沒有計時器照樣登入得了。
  it('不傳計時器也照常運作', async () => {
    const { client } = fakeClient()

    await expect(resolveGuestLogin(client, null)).resolves.toMatchObject({ isNewGuest: true })
  })
})

// Given 訪客 A 與訪客 B 同時以訪客身分瀏覽 / Then A 與 B 各自看到自己的資料
//
// 資料歸屬的實際隔離由既有的授權路徑（缸掛在 User 之下、handler 一律以當前 userId 查）
// 提供，這裡守的是它的前提：兩位訪客拿到的是兩位不同的 User 與兩份不同的缸。
describe('resolveGuestLogin — 兩位訪客互不干擾', () => {
  it('兩位訪客拿到不同的 userId', async () => {
    const { client } = fakeClient()

    const first = await resolveGuestLogin(client, null)
    const second = await resolveGuestLogin(client, null)

    expect(first.userId).not.toBe(second.userId)
  })

  // 訪客的資料一定是自己的那一份，不會掛回模板使用者——否則訪客 A 的修改會直接改到
  // 之後每一位訪客的示範資料（Story ④）。缸的歸屬 #144 之後由 ensureGuestSandbox
  // 決定（guest-sandbox-ensure.test.ts 顧），這裡守的是它的輸入：新訪客拿到的
  // 是一個全新的 userId，不是模板那一位。
  it('新訪客的 userId 不是模板使用者', async () => {
    const { client } = fakeClient()

    const { userId } = await resolveGuestLogin(client, null)

    expect(userId).not.toBe(TEMPLATE_USER.id)
  })
})
