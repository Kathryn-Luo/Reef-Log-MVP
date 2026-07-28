import type { PrismaClient, Tank, User } from '@prisma/client'

// 「當前使用者 / 當前缸」的共用取得方式。各畫面的子 issue 由此取得資料歸屬，
// 不各自重寫查詢條件。
//
// Prisma Client 由呼叫端傳入（server/utils/prisma.ts 的 prisma 實例），
// 不在此處 import 那個實例：函式因此可以在不連資料庫的情況下測試。

/**
 * 當前使用者。認證機制尚未決定（見 schema.prisma 的 User 註解），
 * 現階段一律取最早建立的那一位——也就是 seed 資料中的第一位使用者。
 * 導入認證時只需替換這個函式的內部實作。
 */
export function getCurrentUser(client: PrismaClient): Promise<User | null> {
  return client.user.findFirst({
    orderBy: { createdAt: 'asc' },
  })
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
