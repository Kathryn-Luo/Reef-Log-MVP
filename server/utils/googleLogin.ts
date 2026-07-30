import type { PrismaClient } from '@prisma/client'

// Google 登入的「查／建帳號」（issue #64）。
//
// Prisma Client 由呼叫端傳入，與 currentContext.ts、tankWrite.ts 同一個作法：
// 函式因此能在完全連不到資料庫的情況下測試。
//
// OAuth 的握手（導向 Google、拿 code 換 token、驗 id_token）刻意不在這裡：
// 那一段屬於 `nuxt-auth-utils`，且無法自動化驗證——Google 的 redirect URI 不支援
// 萬用字元，而 Vercel preview 每個 branch 一個動態網址。把「拿到 profile 之後要做
// 什麼」單獨切出來，正是為了讓真正有分支的那一段測得起來。

/** OAuth / OIDC 回傳的 Google 使用者資料，只取這裡用得到的三個欄位。 */
export interface GoogleProfile {
  /** OIDC 的 sub：Google 端那個帳號的穩定識別碼。 */
  sub: string
  /** Google 不保證給得出 email（scope 未授權、或 Apple 式的隱藏信箱）。 */
  email?: string | null
  name?: string | null
}

export interface GoogleLoginResult {
  userId: string
  /** 首次登入（順帶建了帳號）。首次登入引導是另一支子 issue，這裡只把事實回報出去。 */
  isNewUser: boolean
}

/**
 * 依 Google 回傳的 profile 決定「這是誰」，必要時建立帳號。
 *
 *   ① 以 (provider, providerAccountId) 查 Account —— 命中就沿用它的 userId。
 *   ② 未命中 —— 建一位 User，同一次寫入掛上他的 Account。
 *
 * `providerAccountId` 存 OIDC 的 sub 而不是 email：email 可以變更，sub 不會
 * （schema.prisma 的 Account.providerAccountId 註解）。因此 Google 端改過 email 的人
 * 仍然會在第 ① 步命中，不會變成新的一位使用者。
 *
 * Epic #47 第 7 節的 account linking（未命中 Account 時再以 email 查 User，命中則替
 * 那位既有 User 補一列新 Account）排在 MVP 之後，所以這裡目前只有兩步。缺的是「第二種
 * 登入方式進來時要認出同一個人」那一步，不是因為不同 provider 就算不同使用者。
 */
export async function resolveGoogleLogin(
  client: PrismaClient,
  profile: GoogleProfile,
): Promise<GoogleLoginResult> {
  const existing = await client.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: 'GOOGLE',
        providerAccountId: profile.sub,
      },
    },
  })

  if (existing) {
    return { userId: existing.userId, isNewUser: false }
  }

  // 用 nested create 讓 User 與 Account 在同一次寫入裡完成：分兩次寫的話，中間失敗
  // 會留下一位沒有任何 Account、因此永遠登不進來的孤兒 User，而下次登入又會再建一位。
  const user = await client.user.create({
    data: {
      email: profile.email ?? null,
      displayName: profile.name ?? null,
      accounts: {
        create: {
          provider: 'GOOGLE',
          providerAccountId: profile.sub,
        },
      },
    },
  })

  return { userId: user.id, isNewUser: true }
}
