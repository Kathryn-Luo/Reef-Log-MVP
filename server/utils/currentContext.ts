import type { PrismaClient, Tank, User } from '@prisma/client'
import { readSessionPayload } from './session'

// 「當前使用者 / 當前缸」的共用取得方式。各畫面的子 issue 由此取得資料歸屬，
// 不各自重寫查詢條件。
//
// Prisma Client 由呼叫端傳入（server/utils/prisma.ts 的 prisma 實例），
// 不在此處 import 那個實例：函式因此可以在不連資料庫的情況下測試。

/**
 * 當前使用者——依密封 cookie 的內容取得，也就是「cookie 裡那個 userId 對應的那一位」，
 * 而不是 createdAt 最早的那一位（認證導入前的暫時實作，已於 issue #64 移除）。
 *
 * `session` 收的是「解封之後的 payload」而不是 `H3Event`：解封由 `nuxt-auth-utils`
 * 在 server/utils/authContext.ts 那一層做掉，這裡只管「拿到內容之後是誰」。
 * 各 handler 實際呼叫的是那一層的 `getCurrentUser(event)`。
 *
 * 沒有 session、簽章驗不過（解不開 → undefined）或已過期時回 null，
 * 而且**一次資料庫查詢都不會發出**——這正是第 2 節選密封 cookie 而不是 Session 表的
 * 理由之一：未登入的請求不該讓資料庫多做一次工。
 */
export async function getUserFromSession(
  client: PrismaClient,
  session: unknown,
  now: Date,
): Promise<User | null> {
  const payload = readSessionPayload(session, now)

  if (!payload) {
    return null
  }

  // 仍要查一次：cookie 只證明「簽發當時是這個人」，證明不了他現在還在
  // （訪客沙盒會被定期清掉，見 schema.prisma 的 AuthProvider.GUEST）。
  return client.user.findUnique({ where: { id: payload.userId } })
}

/**
 * 當前缸（開啟 App 時顯示的那個缸）。定義依 schema.prisma 的 Tank.displayOrder 註解：
 * 同一使用者的缸 ORDER BY displayOrder ASC, createdAt ASC LIMIT 1，並排除已封存者。
 * schema 刻意沒有 isDefault 旗標，「預設缸」＝排序後的第一個。
 */
export function getCurrentTank(client: PrismaClient, userId: string): Promise<Tank | null> {
  return client.tank.findFirst({
    where: { userId, archivedAt: null },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
  })
}
