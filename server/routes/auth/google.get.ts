// Google 登入的 callback（issue #64、Epic #47 第 1 節）。
//
// 路徑就是登入頁「使用 Google 繼續」那顆按鈕指向的 /auth/google（#63 已定案），
// 也是 Google Cloud Console 上要登記的 Authorized redirect URI（見 .env.example）。
// 掛在 server/routes/ 而不是 server/api/：這是整頁導向的終點，不是給前端 fetch 的端點。
//
// 同一支 handler 處理兩件事，由 `defineOAuthGoogleEventHandler` 依 query 有沒有 code 分流：
// 沒有 code → 導去 Google 的授權頁；有 code → 換 token、取 userinfo，再進 onSuccess。
//
// ⚠ 這一段無法自動化驗證：Google 的 Authorized redirect URI 不支援萬用字元，而 Vercel
// 每個 branch 一個動態 preview 網址 → preview 上按下去必然是 redirect_uri_mismatch
// （Epic #47 的硬約束）。人工驗證只能在 http://localhost:3000/auth/google 與 production 上做。
// 「拿到 profile 之後要做什麼」則全部在 server/utils 的純函式裡，那一段測得起來。
export default defineOAuthGoogleEventHandler({
  config: {
    // 套件的預設是 ['email', 'profile']。補上 openid 是為了 sub——providerAccountId
    // 存的就是它（schema.prisma 的註解：email 會變，sub 不會）。
    // 三者皆為 non-sensitive scope，OAuth 同意畫面 publish 到 Production 不需 Google 審查。
    scope: ['openid', 'email', 'profile'],
  },

  async onSuccess(event, { user }) {
    const profile = toGoogleProfile(user)

    if (!profile) {
      // Google 回了東西，但裡面沒有可用的 sub。這裡不建任何資料，直接當成登入失敗。
      console.error('[auth] Google userinfo 缺少可用的 sub，放棄本次登入')

      return sendRedirect(event, '/login')
    }

    try {
      const { userId } = await resolveGoogleLogin(prisma, profile)

      // 一定要 replace 不能 set：setUserSession 是 defu 合併，前一位使用者留在 cookie 裡的
      // 欄位會原封不動被保留，內容就不再「只有 { userId, exp }」（Story ①）。
      //
      // 密封 cookie 本身的內容只有 buildSessionPayload 那兩個欄位；外層那圈 id / createdAt
      // 是 h3 session 的信封，不是我們放進去的個人資料。
      await replaceUserSession(event, buildSessionPayload(userId, new Date()))
    }
    catch (cause) {
      // 下面的 onError 接不到這一段——它只管到 OAuth 握手為止，onSuccess 內部拋的錯
      // 會直接變成 500。會落在這裡的是資料庫問題（連不上、P2002 重查後仍衝突）
      // 與寫 session 失敗（NUXT_SESSION_PASSWORD 沒設或太短）。
      console.error('[auth] Google 登入成功但建立 session 失敗', cause)

      return sendRedirect(event, '/login')
    }

    // 首次登入引導是另一支子 issue，這裡一律回首頁。isNewUser 因此暫時沒有用到。
    return sendRedirect(event, '/')
  },

  onError(event, error) {
    // 走到這裡的是套件自己回報的失敗：clientId / clientSecret 沒設（handleMissingConfiguration）、
    // 以及 token endpoint 回了 error（handleAccessTokenErrorResponse）——使用者在 Google
    // 那一頁按「取消」也是這一條。
    //
    // ⚠ 不是所有失敗都會經過這裡：requestAccessToken 與 userinfo 的 $fetch 若在網路層拋錯，
    // 套件不會轉呼叫 onError，那會直接是 500。這是套件的行為，不是這裡漏接。
    console.error('[auth] Google 登入失敗', error)

    return sendRedirect(event, '/login')
  },
})
