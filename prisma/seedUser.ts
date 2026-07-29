import type { PrismaClient, User } from '@prisma/client'

// seed 資料的擁有者。
//
// issue #47 定案：seed 建的那一缸保留下來當示範資料，但改掛在「訪客」帳號名下——
// 登入頁的「以訪客身分瀏覽」進來的就是這一位。原本的 'seed-user-kathryn' / 'Kathryn' /
// demo@reeflog.local 是個人化的名字，拿它當公開 preview 上人人看得到的共用示範帳號，
// 會讓人以為那是某個真實使用者的資料。
//
// Prisma Client 由呼叫端傳入，與 server/utils/ 底下的作法一致：函式因此可以在不連
// 資料庫的情況下測試。

/** 訪客（示範）帳號。固定 id，seed 重跑不會長出第二位。 */
export const GUEST_USER = {
  id: 'seed-user-guest',
  email: 'guest@reeflog.local',
  displayName: '訪客',
} as const

/** 改名前的 seed 使用者 id。既有的 dev / preview 資料庫裡還留著這一列。 */
export const LEGACY_SEED_USER_ID = 'seed-user-kathryn'

/**
 * 取得（必要時建立）訪客帳號，並把舊 seed 留下的資料搬過來。
 *
 * 搬遷非做不可：seed 的缸是用固定 id upsert 的，光換掉使用者常數不會動到它們，
 * 那些缸會繼續掛在舊使用者名下，而新的訪客帳號是一個沒有缸的空殼。
 */
export async function upsertGuestUser(client: PrismaClient): Promise<User> {
  const user = await client.user.upsert({
    where: { id: GUEST_USER.id },
    update: { email: GUEST_USER.email, displayName: GUEST_USER.displayName },
    create: { id: GUEST_USER.id, email: GUEST_USER.email, displayName: GUEST_USER.displayName },
  })

  // 順序不能顛倒：Tank.userId 是 onDelete: Cascade，先刪使用者會把示範資料整組帶走。
  await client.tank.updateMany({
    where: { userId: LEGACY_SEED_USER_ID },
    data: { userId: user.id },
  })

  // 舊使用者留著會比訪客帳號早建立，getCurrentUser()（取最早建立的那一位）就會挑到它，
  // 那時候看到的是一個什麼都沒有的帳號。
  await client.user.deleteMany({ where: { id: LEGACY_SEED_USER_ID } })

  return user
}
