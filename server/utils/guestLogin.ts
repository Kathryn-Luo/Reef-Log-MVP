import type { PrismaClient, User } from '@prisma/client'
import type { Timer } from './requestTiming'
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

export interface GuestLoginResult {
  userId: string
  /** 首次進站（順帶建了帳號）。呼叫端目前只用來決定要不要記 log。 */
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
 * 決定「這次進站的訪客是誰」，必要時建立帳號。
 *
 * `existingUser` 是密封 cookie 解出來的那一位（server/utils/authContext.ts 的
 * `getCurrentUser(event)`），沒有就是 null：
 *
 *   ① 已經有身分 —— 沿用，不建第二位（Story ②）。這裡不看 provider：Google 使用者
 *      按到這顆按鈕時，同樣是「你已經登入了」，而不是替他換一個訪客沙盒、
 *      把原本的資料丟在後面。
 *   ② 沒有身分 —— 建一位新的 User + 一列 Account(GUEST, 隨機 id)。
 *
 * ⚠ **這裡不再複製示範資料（issue #144）。**
 *
 * 原本第 ② 步還包含 `copyTemplateSandbox`，兩件事一起放在一個交易裡。實測那一段要
 * 11.5 秒，佔整次請求的 78%（`tx.sandbox.*`），而這條路由的 302 是 handler 最後一行
 * 才發的——訪客因此在登入頁前面對著一片沒有反應的畫面等十幾秒，而那是這個作品集
 * 唯一對外的進站路徑。複製移到了 guestSandbox.ts 的 `ensureGuestSandbox()`，
 * 由首頁在畫面已經看得到之後才呼叫。
 *
 * 交易也跟著拿掉：它原本的用途是把「建帳號」與「複製沙盒」綁在一起，而 User 與 Account
 * 的原子性 nested create 自己就有（同一句 INSERT 鏈）。少了第二件事就沒有東西要綁。
 * 「建了帳號卻沒有沙盒」這個新的中間態由 `User.sandboxSeededAt` 標記，
 * 補完的責任在 `ensureGuestSandbox()`——它自己另開一個交易把 claim 與複製綁在一起。
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
  // 懶連線會把 Neon 的握手時間算進 `user` 那一段裡，量出來的就不是建帳號的成本。
  // #144 之後這兩段是整次請求剩下的**全部**（實測 1439ms + 1377ms），
  // 下一次要再壓時間就得從這兩個數字裡找——混在一起就沒得找了。
  await timer.measure('connect', () => client.$connect())

  // 與 Google 登入同樣用 nested create：分兩次寫的話，中間失敗會留下一位沒有任何
  // Account 的孤兒 User——訪客的身分只存在於 cookie 裡，對不回來就再也清不掉。
  //
  // sandboxSeededAt 刻意不給值，維持 null ＝「這位訪客還欠一份沙盒」。
  // 首頁就是靠它分辨「正在準備」與「真的沒有缸」（見 prisma/schema.prisma 的欄位註解）。
  const user = await timer.measure('user', () => client.user.create({
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

  return { userId: user.id, isNewGuest: true }
}
