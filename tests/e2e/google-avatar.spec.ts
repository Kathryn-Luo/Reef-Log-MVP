import { expect, test } from './support/guestSession'

// Google 頭像寫入 User.googleAvatarUrl（issue #165）。
// E2E 不在 TDD Develop 的 job 內執行，跑在 Vercel preview URL 上。
//
// ⚠ 這一支只驗得到 Story⑥「訪客的 googleAvatarUrl 維持 null」，而且是刻意的。
//
// 其餘五條 Story 全部以「完成一次 Google 登入」為前置狀態，而 Google 的 Authorized
// redirect URI 不支援萬用字元、Vercel 每個分支一個動態網址（CLAUDE.md、Epic #47 的硬約束）
// ——preview 上按下去必然是 redirect_uri_mismatch，登入根本走不完。preview 唯一登得進去
// 的身分就是訪客，而訪客照定義沒有 Google 頭像。
//
// 那些路徑由 tests/unit/server/google-login.test.ts 覆蓋（Prisma Client 是替身），
// 並由人類在 localhost 或 production 以 Google 帳號人工確認一次：重新登入後頭像有寫入、
// 而且自己改過的顯示名稱與上傳過的自訂頭像都沒有被蓋掉。
//
// **不要**為了讓這一支「測到更多東西」而在 E2E 裡直接改資料庫或偽造 session ——
// 那驗到的會是測試自己塞進去的值，不是登入流程。

// Given 我是訪客
// When  我進站後查自己的 profile
// Then  沒有任何頭像來源（googleAvatarUrl 維持 null，也沒有自訂頭像）
test('訪客沒有 Google 頭像，avatarSource 是 none', async ({ page }) => {
  const profile = await (await page.request.get('/api/profile')).json() as {
    avatarUrl: string | null
    avatarSource: string
    providers: string[]
  }

  expect(profile.providers).toEqual(['GUEST'])
  expect(profile.avatarSource).toBe('none')
  expect(profile.avatarUrl).toBeNull()
})
