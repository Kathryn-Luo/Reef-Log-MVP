// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { SESSION_MAX_AGE_SECONDS } from '../../../server/utils/session'
import {
  GUEST_RETENTION_DAYS,
  cleanupExpiredGuestUsers,
} from '../../../server/utils/guestCleanup'

// 清理腳本只透過 User.deleteMany 刪除根節點；資料庫的 FK cascade 會帶走 Account、Tank
// 及其所有下層。單元測試不連真實資料庫，改驗證送給 Prisma 的篩選條件。
function fakeClient(deletedCount = 0) {
  const client = {
    user: {
      deleteMany: vi.fn().mockResolvedValue({ count: deletedCount }),
    },
  }

  return client as unknown as Pick<PrismaClient, 'user'> & typeof client
}

const NOW = new Date('2026-08-04T00:00:00.000Z')
const CUTOFF = new Date('2026-07-05T00:00:00.000Z')

describe('cleanupExpiredGuestUsers', () => {
  // Given 一位 GUEST User 已超過保留期限 / When 執行清理
  // Then 只刪掉 User 根節點，讓資料庫 cascade 帶走整棵沙盒。
  it('只刪除逾期訪客 User，交給資料庫 cascade 清理下層資料', async () => {
    const client = fakeClient(1)

    await expect(cleanupExpiredGuestUsers(client, NOW)).resolves.toBe(1)

    expect(client.user.deleteMany).toHaveBeenCalledWith({
      where: {
        createdAt: { lt: CUTOFF },
        accounts: {
          some: { provider: 'GUEST' },
          none: { provider: { not: 'GUEST' } },
        },
      },
    })
  })

  // Given 一位 GOOGLE 使用者很久以前建立 / When 執行清理
  // Then 他不會進入 GUEST 篩選條件。
  it('不會選到 GOOGLE 使用者', async () => {
    const client = fakeClient()

    await cleanupExpiredGuestUsers(client, NOW)

    const [args] = client.user.deleteMany.mock.calls[0] as unknown as [{
      where: { accounts: { some: { provider: string } } }
    }]
    expect(args.where.accounts.some).toEqual({ provider: 'GUEST' })
  })

  // Given 一位訪客還在保留期限內 / When 執行清理
  // Then createdAt 邊界不會被納入。
  it('不會選到仍在保留期限內的訪客', async () => {
    const client = fakeClient()

    await cleanupExpiredGuestUsers(client, NOW)

    const [args] = client.user.deleteMany.mock.calls[0] as unknown as [{
      where: { createdAt: { lt: Date } }
    }]
    expect(args.where.createdAt.lt).toEqual(CUTOFF)
  })

  // Given seed 模板沒有 Account / When 執行清理
  // Then some(GUEST) 的關聯條件不會選到它。
  it('不會選到沒有 Account 的示範資料模板', async () => {
    const client = fakeClient()

    await cleanupExpiredGuestUsers(client, NOW)

    const [args] = client.user.deleteMany.mock.calls[0] as unknown as [{
      where: { accounts: { some: unknown } }
    }]
    expect(args.where.accounts.some).toEqual({ provider: 'GUEST' })
  })

  // Given 沒有任何逾期訪客 / When 重複執行清理
  // Then 兩次都正常回傳 0。
  it('沒有逾期訪客時回傳 0，重複執行也正常', async () => {
    const client = fakeClient(0)

    await expect(cleanupExpiredGuestUsers(client, NOW)).resolves.toBe(0)
    await expect(cleanupExpiredGuestUsers(client, NOW)).resolves.toBe(0)

    expect(client.user.deleteMany).toHaveBeenCalledTimes(2)
  })
})

describe('GUEST_RETENTION_DAYS', () => {
  it('保留期大於 session 有效期，避免刪掉仍可能持有有效 cookie 的訪客', () => {
    expect(GUEST_RETENTION_DAYS * 24 * 60 * 60).toBeGreaterThan(SESSION_MAX_AGE_SECONDS)
  })
})
