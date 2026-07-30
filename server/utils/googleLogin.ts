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

/**
 * 把 Google userinfo 端點的原始回應收斂成 `GoogleProfile`，收不出來時回 null。
 *
 * `defineOAuthGoogleEventHandler` 的 `onSuccess` 拿到的 `user` 型別是 `any`——它就是
 * `$fetch` 回來的東西，TypeScript 在這個邊界上幫不了任何忙。這一層的用處有兩個：
 *
 *   ① `sub` 是 `@@unique([provider, providerAccountId])` 的一半。少了它就無從決定
 *      「這是誰」，此時寧可整段登入失敗，也不要拿空字串去建一列所有人都會撞在一起的 Account。
 *   ② userinfo 還會回 `picture`、`email_verified`、`locale` 等等。它們一個都不會寫進
 *      資料庫，在這裡就丟掉，而不是一路帶進 `resolveGoogleLogin` 再靠它記得不要用。
 */
export function toGoogleProfile(raw: unknown): GoogleProfile | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }

  const { sub, email, name } = raw as Record<string, unknown>

  if (typeof sub !== 'string' || sub === '') {
    return null
  }

  // email / name 對應的 User 欄位都是 String?，缺漏或型別不對一律當成「Google 沒給」
  return {
    sub,
    email: typeof email === 'string' ? email : null,
    name: typeof name === 'string' ? name : null,
  }
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
