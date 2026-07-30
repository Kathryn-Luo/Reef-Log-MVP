// 登出（issue #64 的 Story ⑤）：清掉密封 cookie，之後的請求一律視為未登入。
//
// 刻意是 POST 而不是 GET：GET 的登出只要一個 <img src="/auth/logout"> 或瀏覽器的
// 連結預抓就會被觸發，等於任何一個網頁都能把人登出。密封 cookie 的 sameSite 是 lax，
// 而 lax 正好放行跨站的 GET 導向——所以這道防線得靠方法本身。
//
// schema.prisma 刻意沒有 Session 表（Epic #47 第 2 節），所以登出只有「清掉這個瀏覽器上的
// cookie」這一個效果，撤銷不了同一把金鑰簽出去的其他 cookie。那是已定案的取捨，
// 緩解手段是縮短有效期（server/utils/session.ts 的 SESSION_MAX_AGE_SECONDS）。
export default defineEventHandler(async (event) => {
  await clearUserSession(event)

  // 瀏覽器跟隨 302 時會改用 GET，所以送出登出表單之後會停在登入頁
  return sendRedirect(event, '/login')
})
