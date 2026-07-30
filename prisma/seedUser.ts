import type { PrismaClient, User } from '@prisma/client'

// seed 資料的擁有者。
//
// issue #65（Epic #47 第 6 節定案）：seed 建的這一位是**模板**，不是訪客帳號本身，
// 也不是任何真實的人。訪客登入的行為是「建一位新 User + 複製一份模板資料」，
// 而不是「登入模板那一位」——所以這一位永遠沒人登入，它只是被複製的來源。
//
// 由此推出三件事：
//   - email 為 null：沒有人用它登入，它不該佔用 User.email 的唯一值。
//     schema 的 User.email 註解已宣告「訪客帳號一律為 null」，Postgres 的 UNIQUE
//     視多個 NULL 為互異，所以「可空」與「唯一」並不衝突。
//   - id / displayName 用模板語義：原本的 'seed-user-kathryn' / 'Kathryn' 是個人的名字，
//     放在公開 preview 上會讓人以為那是某位真實使用者的資料。
//   - 刻意「不」建 Account：見下方 upsertTemplateUser 的說明。
//
// Prisma Client 由呼叫端傳入，與 server/utils/ 底下的作法一致：函式因此可以在不連
// 資料庫的情況下測試。

/** 示範資料的模板使用者。固定 id，seed 重跑不會長出第二位。 */
export const TEMPLATE_USER = {
  id: 'seed-user-template',
  email: null,
  displayName: '示範資料（模板）',
} as const

/** 改名前的 seed 使用者 id。既有的 dev / preview 資料庫裡還留著這一列。 */
export const LEGACY_SEED_USER_ID = 'seed-user-kathryn'

/**
 * 取得（必要時建立）模板使用者，並把舊 seed 留下的資料搬過來。
 *
 * 搬遷非做不可：seed 的缸是用固定 id upsert 的，光換掉使用者常數不會動到它們，
 * 那些缸會繼續掛在舊使用者名下，而模板使用者是一個沒有缸的空殼。
 *
 * 這裡刻意「不」替模板補一列 Account(GUEST, 固定值)。乍看像是漏洞（「訪客登入
 * 查不到它」），但在上述定案下這是正確的：補上去等於把設計退回「共用訪客帳號」，
 * 示範資料會被任何人弄髒、訪客之間互相干擾——而且不會有任何執行期測試抓得到。
 */
export async function upsertTemplateUser(client: PrismaClient): Promise<User> {
  const user = await client.user.upsert({
    where: { id: TEMPLATE_USER.id },
    update: { email: TEMPLATE_USER.email, displayName: TEMPLATE_USER.displayName },
    create: {
      id: TEMPLATE_USER.id,
      email: TEMPLATE_USER.email,
      displayName: TEMPLATE_USER.displayName,
    },
  })

  // 順序不能顛倒：Tank.userId 是 onDelete: Cascade，先刪使用者會把示範資料
  // （缸與其下的水質、生物、保養）整組帶走。
  //
  // 條件只鎖定舊使用者，所以第二輪重跑時 0 列命中，不會重複搬遷。
  await client.tank.updateMany({
    where: { userId: LEGACY_SEED_USER_ID },
    data: { userId: user.id },
  })

  // 舊使用者留著會比模板早建立，getCurrentUser()（取最早建立的那一位）就會挑到它，
  // 那時候看到的是一個什麼都沒有的帳號。
  await client.user.deleteMany({ where: { id: LEGACY_SEED_USER_ID } })

  return user
}
