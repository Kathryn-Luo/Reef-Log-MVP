// 訪客登入（issue #66、Epic #47 第 6 節）。
//
// 路徑就是登入頁「以訪客身分瀏覽」那顆按鈕指向的 /auth/guest（#63 已定案）。
// 掛在 server/routes/ 而不是 server/api/：這是整頁導向的終點，不是給前端 fetch 的端點。
//
// 這是 Vercel preview 與 E2E 唯一走得通的登入路徑——Google 的 Authorized redirect URI
// 不支援萬用字元，而 preview 每個 branch 一個動態網址（Epic #47 的硬約束）。
//
// 為什麼是 GET：登入頁那顆按鈕是一個整頁導向的連結（<a>），而不是表單。代價是「一個 GET
// 會寫入資料」——別的網站放一張 <img src="…/auth/guest"> 就能讓資料庫多一位訪客。
// 那些列拿不到 cookie（Set-Cookie 的 SameSite=Lax 在跨站子資源請求上會被瀏覽器丟掉），
// 所以損害止於「多出沒人用的沙盒」，而過期訪客的清理本來就有一支專門的子 issue。
//
// 判斷全部在 server/utils/guestLogin.ts 的 resolveGuestLogin() 裡，由 unit test 直接呼叫
// 驗證；這裡只有接線，由 auth-wiring.test.ts 看原始碼守著。
export default defineEventHandler(async (event) => {
  try {
    // Story ②：已經有身分就沿用，不再建一個沙盒。「已經是誰」只能從 request 上的密封
    // cookie 得知——少了這一段，每按一次按鈕就多一位訪客與一整份複製出來的示範資料。
    //
    // 這一行也要在 try 之內：getCurrentUser() 自己只接住「讀 session 失敗」，底下那次
    // user.findUnique 的資料庫錯誤仍會往外拋。放在外面的話，同一個資料庫故障發生在
    // 這一行是 500、發生在下一行則導回 /login。
    const existingUser = await getCurrentUser(event)

    const { userId } = await resolveGuestLogin(prisma, existingUser)

    // 一定要 replace 不能 set：setUserSession 是 defu 合併，前一位使用者留在 cookie 裡的
    // 欄位會原封不動被保留，內容就不再「只有 { userId, exp }」（#64 的 Story ①）。
    //
    // 已經有身分時同樣重發一次：內容一樣，但有效期跟著往後推——訪客的沙盒只認得 cookie，
    // cookie 一過期那份資料就再也找不回來了。
    await replaceUserSession(event, buildSessionPayload(userId, new Date()))
  }
  catch (cause) {
    // 會落在這裡的是資料庫問題（連不上、建沙盒的交易逾時）與寫 session 失敗
    // （NUXT_SESSION_PASSWORD 沒設或不足 32 字元）。回登入頁讓人重試，而不是一頁 500。
    console.error('[auth] 訪客登入失敗', cause)

    return sendRedirect(event, '/login')
  }

  return sendRedirect(event, '/')
})
