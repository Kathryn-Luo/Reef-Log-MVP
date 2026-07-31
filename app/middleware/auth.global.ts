import { hasActiveSession, resolveAuthRedirect } from '#shared/utils/routeGuard'

// 路由保護（issue #67）。檔名的 .global 就是「每一頁都跑」——
// 保護是預設值，頁面自己不必宣告，新頁面也不會漏掉。
//
// 判斷全在 #shared/utils/routeGuard 的純函式裡（那一支由 route-guard.test.ts 直接
// 呼叫驗證），這裡只做兩件事：把「當前路徑」與「cookie 裡的身分」餵進去，
// 並把導向的結果回傳給 router。
//
// ⚠ 這是 UX 不是安全邊界：它讓未登入的人不會先看到半個空殼畫面，
// 但真正的資料歸屬檢查在 server/api/**（issue 的「非目標」第一條）。
export default defineNuxtRouteMiddleware((to) => {
  // 只讀密封 cookie 解開後的內容，不打資料庫、也不為了這個判斷多送一次請求：
  // session 在 SSR 那一次就由 nuxt-auth-utils 的 plugin 取好放進狀態了。
  const { session } = useUserSession()

  const redirect = resolveAuthRedirect({
    path: to.path,
    signedIn: hasActiveSession(session.value, new Date()),
  })

  if (!redirect) {
    return
  }

  // replace：導向的來源頁面不該留在歷史紀錄裡，
  // 否則按上一頁會回到那一頁、又被導走一次，上一頁就此按不動。
  return navigateTo(redirect, { replace: true })
})
