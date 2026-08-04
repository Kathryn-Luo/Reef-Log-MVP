import type { PrismaClient } from '@prisma/client'

/**
 * 訪客沙盒保留期。
 *
 * 30 天大於 session 的 7 天有效期，已過期的密封 cookie 不會再指向被清掉的訪客資料。
 * 這是 production 真人訪客的手動清理；排程與 preview / E2E 資料庫處理不在此工具範圍。
 */
export const GUEST_RETENTION_DAYS = 30

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000

/** 刪除逾期訪客沙盒，回傳刪除的 User 筆數。 */
export async function cleanupExpiredGuestUsers(
  client: Pick<PrismaClient, 'user'>,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - GUEST_RETENTION_DAYS * DAY_IN_MILLISECONDS)

  const { count } = await client.user.deleteMany({
    where: {
      createdAt: { lt: cutoff },
      accounts: {
        some: { provider: 'GUEST' },
        // 未來若有帳號 linking，保留任何非 GUEST 登入方式的使用者，避免誤刪真人帳號。
        none: { provider: { not: 'GUEST' } },
      },
    },
  })

  return count
}
