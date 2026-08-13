// @vitest-environment node
// 純函式測試，不碰 Vue 元件、Nuxt composable 或 DOM；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getCurrentTank, getUserFromSession } from '../../../server/utils/currentContext'
import { buildSessionPayload } from '../../../server/utils/session'

// 這個 job 連不到資料庫，Prisma Client 一律以假物件替身餵入（函式簽章刻意收 client 參數）
function fakeClient(overrides: {
  user?: unknown
  tank?: unknown
}) {
  const client = {
    user: {
      findFirst: vi.fn().mockResolvedValue(overrides.user ?? null),
      findUnique: vi.fn().mockResolvedValue(overrides.user ?? null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    tank: { findFirst: vi.fn().mockResolvedValue(overrides.tank ?? null) },
  }

  return client as unknown as PrismaClient & typeof client
}

// 這裡原本還有一個 `getCurrentUser` 的 describe，驗的是認證導入前的暫時實作
// 「一律取 createdAt 最早的那一位使用者」。那正是 Story ③ 要求換掉的行為
// （「而不是 createdAt 最早的那一位」），函式本身也已從 currentContext.ts 移除，
// 所以那兩個案例跟著移除，不是被跳過。
//
// 它們原本守的東西改由兩處接手：
//   - 身分改從 session 來 → 下面的 getUserFromSession（案例更完整）
//   - 舊查詢確實不再存在 → auth-wiring.test.ts「server 端不再有『取最早建立的那一位』的查詢」
//
// 取代它的 `getCurrentUser(event)` 在 server/utils/authContext.ts，只有一行、
// 整行都是 Nitro 自動匯入（getUserSession / prisma），在這個環境裡 import 不進來——
// 它有沒有被接上由 auth-wiring.test.ts 看原始碼守著。

describe('getUserFromSession', () => {
  const now = new Date('2026-07-30T00:00:00.000Z')

  // issue #175 之後這支函式會順手更新 `lastActiveAt`，所以假使用者也要有那一欄——
  // 少了它，節流判斷拿到的是 undefined，測試會在一個現實中不存在的狀態上跑。
  // 剛更新過的那一位（＝節流區間內）用來驗「不該寫」的案例。
  const ACTIVE_USER = { id: 'user-7', lastActiveAt: now }
  const IDLE_USER = { id: 'user-7', lastActiveAt: new Date('2026-07-01T00:00:00.000Z') }

  // Story ③「Then 取到的是 cookie 中 userId 對應的那一位，而不是 createdAt 最早的那一位」
  it('取 session 中 userId 對應的那一位', async () => {
    const client = fakeClient({ user: ACTIVE_USER })

    await expect(getUserFromSession(client, buildSessionPayload('user-7', now), now))
      .resolves.toEqual(ACTIVE_USER)

    expect(client.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-7' } })
  })

  it('不再退回「createdAt 最早的那一位」', async () => {
    const client = fakeClient({ user: ACTIVE_USER })

    await getUserFromSession(client, buildSessionPayload('user-7', now), now)

    expect(client.user.findFirst).not.toHaveBeenCalled()
  })

  // session 指向的使用者已被刪除（例如訪客沙盒被清掉）→ 視為未登入
  it('session 指向的使用者已不存在時回傳 null', async () => {
    await expect(getUserFromSession(fakeClient({}), buildSessionPayload('user-7', now), now))
      .resolves.toBeNull()
  })

  // issue #175：schema 對 `User.lastActiveAt` 寫著「最近一次辨識出這位使用者並準備續發
  // session 的時間」，而在這之前全 repo 沒有任何地方寫入它——值永遠等於 createdAt，
  // 於是「天天在用的訪客不會被清掉」這個保證只寫在註解裡。辨識出使用者的地方只有這一支，
  // 更新放在這裡，每一支 API handler 都不必自己記得。
  it('辨識出使用者時把 lastActiveAt 推進到現在', async () => {
    const client = fakeClient({ user: IDLE_USER })

    await getUserFromSession(client, buildSessionPayload('user-7', now), now)

    expect(client.user.updateMany).toHaveBeenCalledTimes(1)

    const [args] = client.user.updateMany.mock.calls[0] as unknown as [{
      where: { id: string }
      data: { lastActiveAt: Date }
    }]
    expect(args.where.id).toBe('user-7')
    expect(args.data.lastActiveAt).toEqual(now)
  })

  // Given 我在同一分鐘內連續打了多支 API / When 每一次請求都辨識出我
  // Then lastActiveAt 不會被寫入 N 次
  //
  // 節流本身的完整案例在 last-active.test.ts；這裡守的是「這支函式真的有節流」——
  // 少了它，每一支 API 都會多一次資料庫寫入。
  it('剛更新過的使用者不會再寫一次', async () => {
    const client = fakeClient({ user: ACTIVE_USER })

    await getUserFromSession(client, buildSessionPayload('user-7', now), now)
    await getUserFromSession(client, buildSessionPayload('user-7', now), now)
    await getUserFromSession(client, buildSessionPayload('user-7', now), now)

    expect(client.user.updateMany).not.toHaveBeenCalled()
  })

  // 使用者已經被清掉時沒有什麼好更新的，那句 update 也不該發出去。
  it('session 指向的使用者已不存在時不寫入 lastActiveAt', async () => {
    const client = fakeClient({})

    await getUserFromSession(client, buildSessionPayload('user-7', now), now)

    expect(client.user.updateMany).not.toHaveBeenCalled()
  })

  // Story ④「Given 我沒有 cookie，或 cookie 已過期／簽章驗不過 → 取到 null」
  it('沒有 cookie / 簽章驗不過時回傳 null', async () => {
    await expect(getUserFromSession(fakeClient({ user: { id: 'user-7' } }), undefined, now))
      .resolves.toBeNull()
  })

  it('cookie 已過期時回傳 null', async () => {
    const expired = buildSessionPayload('user-7', new Date('2026-07-01T00:00:00.000Z'), 60)

    await expect(getUserFromSession(fakeClient({ user: { id: 'user-7' } }), expired, now))
      .resolves.toBeNull()
  })

  // Story ④「And 判定『未登入』的過程中沒有對資料庫發出任何查詢」
  // ——這正是第 2 節選密封 cookie（而不是 Session 表）的理由之一。
  it('判定未登入的過程中完全不查資料庫', async () => {
    const client = fakeClient({ user: ACTIVE_USER })
    const expired = buildSessionPayload('user-7', new Date('2026-07-01T00:00:00.000Z'), 60)

    await getUserFromSession(client, undefined, now)
    await getUserFromSession(client, expired, now)
    await getUserFromSession(client, { userId: '', exp: 0 }, now)

    expect(client.user.findUnique).not.toHaveBeenCalled()
    expect(client.user.findFirst).not.toHaveBeenCalled()
    expect(client.tank.findFirst).not.toHaveBeenCalled()
    // issue #175 的更新同樣不能破壞這一條：未登入的請求連寫入都不該有
    expect(client.user.updateMany).not.toHaveBeenCalled()
  })

  // Story ⑤「Then cookie 被清除，之後的請求一律視為未登入」
  // 登出把 cookie 清掉之後，server 這一側收到的就是「沒有 session」。
  it('登出清掉 cookie 之後，後續請求一律視為未登入', async () => {
    const client = fakeClient({ user: { id: 'user-7' } })

    await expect(getUserFromSession(client, null, now)).resolves.toBeNull()
    expect(client.user.findUnique).not.toHaveBeenCalled()
  })
})

describe('getCurrentTank', () => {
  // 「當前缸」＝ 同一 userId 的缸 ORDER BY displayOrder ASC, createdAt ASC LIMIT 1，
  // 且排除已封存者（schema.prisma 的 Tank.displayOrder 註解，刻意沒有 isDefault 旗標）
  it('依 displayOrder、createdAt 取第一個未封存的缸', async () => {
    const client = fakeClient({ tank: { id: 'tank-1' } })

    await expect(getCurrentTank(client, 'user-1')).resolves.toEqual({ id: 'tank-1' })
    expect(client.tank.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', archivedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    })
  })

  it('使用者名下沒有未封存的缸時回傳 null', async () => {
    await expect(getCurrentTank(fakeClient({}), 'user-1')).resolves.toBeNull()
  })
})
