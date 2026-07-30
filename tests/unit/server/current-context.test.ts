import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getCurrentTank, getCurrentUser, getUserFromSession } from '../../../server/utils/currentContext'
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
    },
    tank: { findFirst: vi.fn().mockResolvedValue(overrides.tank ?? null) },
  }

  return client as unknown as PrismaClient & typeof client
}

describe('getCurrentUser', () => {
  // 認證尚未實作，當前使用者一律取最早建立的那一位（seed 的第一位）
  it('取最早建立的使用者', async () => {
    const client = fakeClient({ user: { id: 'user-1' } })

    await expect(getCurrentUser(client)).resolves.toEqual({ id: 'user-1' })
    expect(client.user.findFirst).toHaveBeenCalledWith({
      orderBy: { createdAt: 'asc' },
    })
  })

  it('沒有任何使用者時回傳 null', async () => {
    await expect(getCurrentUser(fakeClient({}))).resolves.toBeNull()
  })
})

describe('getUserFromSession', () => {
  const now = new Date('2026-07-30T00:00:00.000Z')

  // Story ③「Then 取到的是 cookie 中 userId 對應的那一位，而不是 createdAt 最早的那一位」
  it('取 session 中 userId 對應的那一位', async () => {
    const client = fakeClient({ user: { id: 'user-7' } })

    await expect(getUserFromSession(client, buildSessionPayload('user-7', now), now))
      .resolves.toEqual({ id: 'user-7' })

    expect(client.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-7' } })
  })

  it('不再退回「createdAt 最早的那一位」', async () => {
    const client = fakeClient({ user: { id: 'user-7' } })

    await getUserFromSession(client, buildSessionPayload('user-7', now), now)

    expect(client.user.findFirst).not.toHaveBeenCalled()
  })

  // session 指向的使用者已被刪除（例如訪客沙盒被清掉）→ 視為未登入
  it('session 指向的使用者已不存在時回傳 null', async () => {
    await expect(getUserFromSession(fakeClient({}), buildSessionPayload('user-7', now), now))
      .resolves.toBeNull()
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
    const client = fakeClient({ user: { id: 'user-7' } })
    const expired = buildSessionPayload('user-7', new Date('2026-07-01T00:00:00.000Z'), 60)

    await getUserFromSession(client, undefined, now)
    await getUserFromSession(client, expired, now)
    await getUserFromSession(client, { userId: '', exp: 0 }, now)

    expect(client.user.findUnique).not.toHaveBeenCalled()
    expect(client.user.findFirst).not.toHaveBeenCalled()
    expect(client.tank.findFirst).not.toHaveBeenCalled()
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
