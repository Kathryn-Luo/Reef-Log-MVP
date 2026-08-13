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

const DAY = 24 * 60 * 60 * 1000

/** 取出送給 Prisma 的 where，用來直接檢查篩選條件本身。 */
function whereOf(client: ReturnType<typeof fakeClient>) {
  const [args] = client.user.deleteMany.mock.calls[0] as unknown as [{
    where: {
      createdAt?: { lt: Date }
      lastActiveAt?: { lt: Date }
      accounts: { some: unknown, none: unknown }
    }
  }]

  return args.where
}

/**
 * 這位使用者會不會被上面那個 where 選中——只評估時間條件那一半。
 *
 * 直接比對 where 的字面值只證明「條件長這樣」，證明不了 Story 的兩條 Then
 * （「40 天前建立但昨天還在用 → 不刪」）真的成立。這個小小的評估器把兩者接起來。
 */
function wouldDelete(where: ReturnType<typeof whereOf>, user: { createdAt: Date, lastActiveAt: Date }) {
  return (where.createdAt === undefined || user.createdAt < where.createdAt.lt)
    && (where.lastActiveAt === undefined || user.lastActiveAt < where.lastActiveAt.lt)
}

describe('cleanupExpiredGuestUsers', () => {
  // Given 一位 GUEST User 已超過保留期限 / When 執行清理
  // Then 只刪掉 User 根節點，讓資料庫 cascade 帶走整棵沙盒。
  it('只刪除逾期訪客 User，交給資料庫 cascade 清理下層資料', async () => {
    const client = fakeClient(1)

    await expect(cleanupExpiredGuestUsers(client, NOW)).resolves.toBe(1)

    expect(client.user.deleteMany).toHaveBeenCalledWith({
      where: {
        lastActiveAt: { lt: CUTOFF },
        accounts: {
          some: { provider: 'GUEST' },
          none: { provider: { not: 'GUEST' } },
        },
      },
    })
  })

  // issue #175 / Story 第一條
  // Given 我是訪客，帳號已建立 40 天，但昨天還在用
  // When  訪客清理腳本執行
  // Then  我的沙盒不被刪除
  it('帳號建立超過保留期，但最近還在用的訪客不會被刪除', async () => {
    const client = fakeClient()

    await cleanupExpiredGuestUsers(client, NOW)

    expect(wouldDelete(whereOf(client), {
      createdAt: new Date(NOW.getTime() - 40 * DAY),
      lastActiveAt: new Date(NOW.getTime() - 1 * DAY),
    })).toBe(false)
  })

  // issue #175 / Story 第二條
  // Given 我是訪客，最後一次進站是 40 天前
  // When  訪客清理腳本執行
  // Then  我的沙盒被刪除
  it('最後一次進站已超過保留期的訪客會被刪除', async () => {
    const client = fakeClient()

    await cleanupExpiredGuestUsers(client, NOW)

    expect(wouldDelete(whereOf(client), {
      createdAt: new Date(NOW.getTime() - 40 * DAY),
      lastActiveAt: new Date(NOW.getTime() - 40 * DAY),
    })).toBe(true)
  })

  // 逾期與否只看 lastActiveAt。留著 createdAt 那一條的話，上面第一條 Then 會被它
  // 一票否決——兩個條件是 AND，久遠的建立時間仍然會把人選進來。
  it('完全不以 createdAt 判斷逾期', async () => {
    const client = fakeClient()

    await cleanupExpiredGuestUsers(client, NOW)

    expect(whereOf(client).createdAt).toBeUndefined()
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
  // Then lastActiveAt 邊界不會被納入。
  it('不會選到仍在保留期限內的訪客', async () => {
    const client = fakeClient()

    await cleanupExpiredGuestUsers(client, NOW)

    expect(whereOf(client).lastActiveAt?.lt).toEqual(CUTOFF)
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
  // 這個推論成立的前提是「逾期以最後一次活動計算」（issue #175）：以 createdAt 計算時，
  // 一位天天在用的訪客手上那張永遠續著的 cookie 照樣會指向被刪掉的資料。
  it('保留期大於 session 有效期，避免刪掉仍可能持有有效 cookie 的訪客', () => {
    expect(GUEST_RETENTION_DAYS * 24 * 60 * 60).toBeGreaterThan(SESSION_MAX_AGE_SECONDS)
  })
})
