import type { PrismaClient, User } from '@prisma/client'
import type { Timer } from './requestTiming'
import { copyTemplateSandbox } from './guestSandbox'
import { createTimer } from './requestTiming'

// 訪客登入的「查／建帳號」（issue #66、Epic #47 第 6 節）。
//
// 與 googleLogin.ts 對稱：Prisma Client 由呼叫端傳入，所有分支都在這支純函式裡，
// 接線（讀 cookie、發 cookie、導向）留在 server/routes/auth/guest.get.ts。
//
// 最關鍵的一件事：**每位訪客一個獨立帳號**。這裡沒有「找一位既有的訪客沿用」的路徑，
// 沒有 session 就是建一位新的。共用帳號 + 可寫會讓訪客互相干擾、示範缸被任何人弄髒；
// 獨立沙盒同時讓授權邏輯對訪客與 Google 使用者完全一致——沒有一支寫入 API 需要判斷 provider。

/** schema.prisma 的 User.displayName 註解：「訪客固定為『訪客』」。 */
export const GUEST_DISPLAY_NAME = '訪客'

/**
 * 建沙盒的交易上限（毫秒）。
 *
 * Prisma 互動式交易的預設是 5 秒，而這裡要跑的是「模板有幾個缸就幾句 nested create」，
 * 每一句底下又是數十筆 insert。Neon 是 serverless，連線延遲比本機高得多，5 秒是會踩到的。
 * 逾時的後果不是慢，是整個訪客登入失敗，所以放寬到 30 秒——這條路徑一位訪客只走一次。
 */
const SANDBOX_TRANSACTION_TIMEOUT_MS = 30_000

/**
 * 等一條可用連線的上限（毫秒）。
 *
 * 與 timeout 是兩件事：timeout 管的是「交易開始之後能跑多久」，maxWait 管的是「交易
 * 開始之前能等多久」，預設只有 2 秒。Neon 是 serverless，連線吃緊時光是拿到連線就可能
 * 超過 2 秒——只放寬 timeout 會留下一個很難查的故障：交易根本還沒開始就失敗了，
 * 而錯誤訊息談的是交易。
 */
const SANDBOX_TRANSACTION_MAX_WAIT_MS = 10_000

export interface GuestLoginResult {
  userId: string
  /** 首次進站（順帶建了帳號與沙盒）。呼叫端目前只用來決定要不要記 log。 */
  isNewGuest: boolean
}

/**
 * 產生一位訪客的 `providerAccountId`。
 *
 * schema.prisma 的 Account.providerAccountId 註解：「GUEST → 每位訪客各自一個隨機 id，
 * 於首次進站時產生」。用 randomUUID 而不是遞增值或固定值：@@unique([provider,
 * providerAccountId]) 只保證不重複，猜不猜得到得自己負責——猜得到就等於別人的沙盒可以被指名。
 */
export function createGuestAccountId(): string {
  return crypto.randomUUID()
}

/**
 * 決定「這次進站的訪客是誰」，必要時建立帳號與沙盒。
 *
 * `existingUser` 是密封 cookie 解出來的那一位（server/utils/authContext.ts 的
 * `getCurrentUser(event)`），沒有就是 null：
 *
 *   ① 已經有身分 —— 沿用，不建第二位、也不重複複製示範資料（Story ②）。
 *      這裡不看 provider：Google 使用者按到這顆按鈕時，同樣是「你已經登入了」，
 *      而不是替他換一個訪客沙盒、把原本的資料丟在後面。
 *   ② 沒有身分 —— 建一位新的 User + 一列 Account(GUEST, 隨機 id)，並複製一份模板資料。
 *
 * 第 ② 步整個包在一個交易裡：建帳號與複製沙盒之間若失敗，訪客會拿到一個只有半份資料的
 * 沙盒，而且因為 User 已經存在，之後再進站也不會補完（第 ① 步就沿用了）。兩件事因此必須
 * 一起成立或一起不成立。
 *
 * 沒有 P2002 的重試路徑（googleLogin.ts 有）：那裡的衝突來自「同一個 Google 帳號同時
 * 首次登入兩次」，而訪客的 providerAccountId 是每次現產的隨機值，兩個併發請求本來就
 * 該是兩位不同的訪客。
 *
 * `timer` 是 issue #98 的分段計時（方向 A「先量再改」）。不傳就自己開一個丟掉——
 * 計時是附加的，沒有它照樣登入得了。
 */
export async function resolveGuestLogin(
  client: PrismaClient,
  existingUser: User | null,
  timer: Timer = createTimer(),
): Promise<GuestLoginResult> {
  if (existingUser) {
    return { userId: existingUser.id, isNewGuest: false }
  }

  // 明確先連一次，而不是靠 Prisma 的「第一次查詢時才連」（issue #98）。
  //
  // 懶連線會把 Neon 的握手時間算進交易裡——甚至算進 maxWait 的等待，因為那時交易
  // 還沒真的開始。那樣量出來的 `tx` 不是交易的成本，而「連線慢」與「交易重」對應的
  // 是完全不同的對策（前者做方向 B / C 全是白改）。先連完再開交易，兩個數字才分得開。
  await timer.measure('connect', () => client.$connect())

  const userId = await timer.measure('tx', () => client.$transaction(
    async (tx) => {
      // 與 Google 登入同樣用 nested create：分兩次寫的話，中間失敗會留下一位沒有任何
      // Account 的孤兒 User——訪客的身分只存在於 cookie 裡，對不回來就再也清不掉。
      const user = await timer.measure('tx.user', () => tx.user.create({
        data: {
          email: null,
          displayName: GUEST_DISPLAY_NAME,
          accounts: {
            create: {
              provider: 'GUEST',
              providerAccountId: createGuestAccountId(),
            },
          },
        },
      }))

      await copyTemplateSandbox(tx, user.id, timer)

      return user.id
    },
    {
      timeout: SANDBOX_TRANSACTION_TIMEOUT_MS,
      maxWait: SANDBOX_TRANSACTION_MAX_WAIT_MS,
    },
  ))

  return { userId, isNewGuest: true }
}
