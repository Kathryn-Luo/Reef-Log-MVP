import type { PrismaClient, User } from '@prisma/client'

// `User.lastActiveAt` 的維護（issue #175）。
//
// schema.prisma 對這一欄寫的是「最近一次辨識出這位使用者並準備續發 session 的時間」，
// 而在這之前**全 repo 沒有任何地方寫入它**——值永遠等於 createdAt，於是那段註解承諾的
// 「長期使用的訪客不會因為帳號建立超過保留期而被刪掉」只存在於註解裡。
// 一位天天在用的訪客，帳號滿 30 天就會連同缸、生物、水質記錄一起消失，
// 而他手上那張 cookie 還是有效的（session 7 天，每次進站都會續）。
//
// 這個檔案只做「什麼時候該寫、寫什麼」，Prisma Client 由呼叫端傳入：
// 與 currentContext.ts、guestSandbox.ts 同一個作法，函式因此在連不到資料庫時也測得起來。

/**
 * 兩次寫入之間至少要隔多久（毫秒）。
 *
 * 「辨識出使用者」發生在**每一支需要身分的 API** 上，照實寫的話等於替每個請求多加一次
 * 資料庫寫入——首頁一次載入就有好幾支。所以只在夠久沒更新時才寫。
 *
 * 一小時是照著這個欄位的用途挑的：它唯一的讀者是訪客清理（保留期 30 天），
 * 節流造成的落後最多一小時，相對 30 天可以忽略；反過來每位活躍使用者一天最多 24 次寫入，
 * 而不是「每支 API 一次」。要更精確的活躍度時再縮短，那時付的代價是寫入次數。
 */
export const LAST_ACTIVE_REFRESH_INTERVAL_MS = 60 * 60 * 1000

/**
 * 這一位的 `lastActiveAt` 該不該更新——夠久沒更新才算數。
 *
 * 邊界取「剛好等於區間 → 不寫」，與下面 where 條件裡的 `lt` 對齊：兩邊若一邊 `<`、
 * 一邊 `<=`，落在邊界的那一次會發出一句必定 0 筆的 update。
 *
 * 未來的時間（Vercel 與 Neon 的時鐘不必然一致）走的是同一條路：那只是「還很新」，
 * 不會因此變成每個請求都寫。
 */
export function shouldRefreshLastActiveAt(lastActiveAt: Date, now: Date): boolean {
  return lastActiveAt.getTime() < now.getTime() - LAST_ACTIVE_REFRESH_INTERVAL_MS
}

/**
 * 把這一位的 `lastActiveAt` 推進到 `now`，距離上次更新還很近時什麼都不做。
 *
 * 用 `updateMany` 而不是 `update`，是為了在 where 裡帶上「還沒被更新過」這個條件——
 * 那是節流的第二層。上面那層看的是這個請求**讀到**的值，同一位使用者的多支 API
 * 併發時會讀到同一份舊快照，於是每一支都認為該寫。條件放進 where 之後，
 * 資料庫自己會讓其中一句寫成、其餘 0 筆（與 guestSandbox.ts 的 claim 同一個手法）。
 *
 * 刻意不接住錯誤：這裡的寫入緊接在同一位使用者的 `findUnique` 之後，那次讀得成、
 * 這次寫不成，是資料庫真的出事，不該被偽裝成「一切正常」——那會讓沙盒安靜地逾期。
 * 而更新失敗最多就是這一輪沒推進，下一個請求會再試。
 */
export async function touchLastActiveAt(
  client: Pick<PrismaClient, 'user'>,
  user: Pick<User, 'id' | 'lastActiveAt'>,
  now: Date,
): Promise<void> {
  if (!shouldRefreshLastActiveAt(user.lastActiveAt, now)) {
    return
  }

  await client.user.updateMany({
    where: {
      id: user.id,
      lastActiveAt: { lt: new Date(now.getTime() - LAST_ACTIVE_REFRESH_INTERVAL_MS) },
    },
    data: { lastActiveAt: now },
  })
}
