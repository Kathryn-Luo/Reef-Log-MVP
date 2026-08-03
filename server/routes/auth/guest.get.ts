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

// issue #98：instance 的探針一定要在 handler 外面建立。建在裡面的話每個請求都是自己的
// 「第一次」，cold 永遠是 true，而「這 10 秒是不是 Vercel 冷啟」正是要排除或坐實的猜測。
const probeInstance = createInstanceProbe()

export default defineEventHandler(async (event) => {
  // issue #98 的方向 A「先量再改」：preview 上這一次請求要 9.4～14.8 秒，而「交易太重」、
  // 「Neon 連線建立慢」、「Vercel 冷啟」三個猜測目前分不開。整條路徑因此逐段量，
  // 交易內部的細分在 guestLogin.ts / guestSandbox.ts 裡（同一個計時器往下傳）。
  const timer = createTimer()
  const instance = probeInstance()

  let destination = '/'

  try {
    // Story ②：已經有身分就沿用，不再建一個沙盒。「已經是誰」只能從 request 上的密封
    // cookie 得知——少了這一段，每按一次按鈕就多一位訪客與一整份複製出來的示範資料。
    //
    // 這一行也要在 try 之內：getCurrentUser() 自己只接住「讀 session 失敗」，底下那次
    // user.findUnique 的資料庫錯誤仍會往外拋。放在外面的話，同一個資料庫故障發生在
    // 這一行是 500、發生在下一行則導回 /login。
    //
    // 它自己就是一趟資料庫查詢，所以也要量：不量的話這段時間只會沉進 total 與各段落
    // 之間的差額裡，被讀成「不知道花到哪去了」。
    const existingUser = await timer.measure('session.read', () => getCurrentUser(event))

    const { userId, isNewGuest } = await resolveGuestLogin(prisma, existingUser, timer)

    // 一定要 replace 不能 set：setUserSession 是 defu 合併，前一位使用者留在 cookie 裡的
    // 欄位會原封不動被保留，內容就不再「只有 { userId, exp }」（#64 的 Story ①）。
    //
    // 已經有身分時同樣重發一次：內容一樣，但有效期跟著往後推——訪客的沙盒只認得 cookie，
    // cookie 一過期那份資料就再也找不回來了。
    await timer.measure(
      'session.write',
      () => replaceUserSession(event, buildSessionPayload(userId, new Date())),
    )

    console.info(formatTimingLog('[auth] 訪客登入計時', timer, instance, { newGuest: isNewGuest }))
  }
  catch (cause) {
    // 會落在這裡的是資料庫問題（連不上、建沙盒的交易逾時）與寫 session 失敗
    // （NUXT_SESSION_PASSWORD 沒設或不足 32 字元）。回登入頁讓人重試，而不是一頁 500。
    //
    // 失敗這一次也要帶著分段：交易逾時的時候，人要知道它是卡在哪一段才逾時的。
    console.error(formatTimingLog('[auth] 訪客登入失敗', timer, instance), cause)

    destination = '/login'
  }

  // 數字也回到回應上（成功與失敗都是）。#95 量那五次用的是 Playwright，而 Vercel 的
  // runtime log 要進 console 才翻得到——放在標頭上，量一次的成本就跟按一次按鈕一樣低。
  // 這是診斷用的，方向 B / C / D 落地之後可以拿掉。
  //
  // 兩個標頭而不是一個：**`Server-Timing` 到不了 preview 的客戶端**。E2E 第一次在 CI 上
  // 跑（run 30809735121）時，三條計時的 test 全部拿到 `undefined`，三次重試皆然。
  // 已排除「h3 的 sendRedirect 會丟掉先設的標頭」這個可能——本機用同版 h3 重現同樣的
  // 形狀（setResponseHeader → return sendRedirect），302 上兩個標頭都在。所以吃掉它的
  // 是 Vercel 那一層（它自己也用 Server-Timing 回報邊緣的量測）。
  //
  // 因此 E2E 讀的是 `X-Guest-Timing`（自訂名稱，Vercel 沒有理由碰它），
  // `Server-Timing` 仍然照發——它在本機與任何不改寫標頭的環境下，devtools 的 Network
  // 面板會直接畫成時間軸，那是自訂標頭給不了的。
  const timing = formatServerTiming(timer, instance)

  setResponseHeader(event, 'Server-Timing', timing)
  setResponseHeader(event, 'X-Guest-Timing', timing)

  return sendRedirect(event, destination)
})
