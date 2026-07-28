import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getCurrentTank, getCurrentUser } from '../../../server/utils/currentContext'

// 這個 job 連不到資料庫，Prisma Client 一律以假物件替身餵入（函式簽章刻意收 client 參數）
function fakeClient(overrides: {
  user?: unknown
  tank?: unknown
}) {
  const client = {
    user: { findFirst: vi.fn().mockResolvedValue(overrides.user ?? null) },
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
