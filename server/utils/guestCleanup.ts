import type { PrismaClient } from '@prisma/client'

/**
 * 訪客沙盒保留期——從**最後一次活動**起算，不是從帳號建立起算。
 *
 * 30 天大於 session 的 7 天有效期，已過期的密封 cookie 不會再指向被清掉的訪客資料。
 * 這個推論的前提是逾期以 `lastActiveAt` 判斷（issue #175）：以 createdAt 判斷時它不成立
 * ——訪客每次進站都會續一張新的 7 天 cookie，帳號建立那天卻不會跟著往後移，
 * 於是一位天天在用的訪客滿 30 天就會被刪掉，手上那張 cookie 還是有效的。
 *
 * 這是 production 真人訪客的手動清理；排程與 preview / E2E 資料庫處理不在此工具範圍。
 */
export const GUEST_RETENTION_DAYS = 30

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000

/**
 * 刪除逾期訪客沙盒，回傳刪除的 User 筆數。
 *
 * 「逾期」＝ `lastActiveAt` 早於保留期（schema.prisma 對該欄位的註解就是這個定義）。
 * 刻意**不**同時看 createdAt：兩個條件是 AND，久遠的建立時間會把「昨天還在用」的訪客
 * 一起選進來，等於這一整條改動沒發生（issue #175）。
 */
export async function cleanupExpiredGuestUsers(
  client: Pick<PrismaClient, 'user'>,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - GUEST_RETENTION_DAYS * DAY_IN_MILLISECONDS)

  const { count } = await client.user.deleteMany({
    where: {
      lastActiveAt: { lt: cutoff },
      accounts: {
        some: { provider: 'GUEST' },
        // 未來若有帳號 linking，保留任何非 GUEST 登入方式的使用者，避免誤刪真人帳號。
        none: { provider: { not: 'GUEST' } },
      },
    },
  })

  return count
}
