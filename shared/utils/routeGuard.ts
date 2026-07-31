// 路由保護的判斷規則（issue #67）。
//
// ⚠ 這一層是 UX，不是安全邊界。它決定的只有「這一頁現在要不要先導去登入頁」，
// 真正的資料歸屬檢查在 server/api/**，兩者都要有（issue 的「非目標」第一條）。
// 換句話說：這裡判斷錯了，最壞的情況是畫面多跳一次或少跳一次，
// 不會因此讓任何人讀到別人的資料——那由 server 端把關。
//
// 整支檔案都是純函式、放在 shared/ 而不是 app/：app 端的 middleware 與 plugin
// 共用同一組規則，測試也就能直接呼叫它們，不必先架一個 router 起來。

export const LOGIN_PATH = '/login'
export const HOME_PATH = '/'

/**
 * 不需登入就能開的路徑（issue #67 的「例外」清單）。
 *
 * 這是白名單，不是黑名單：清單以外的一律要登入。反過來寫的話，
 * 每新增一頁就要記得回來補一次，漏掉一次就是別人的資料被看見。
 *
 * `/api/health` 照 issue 的清單列在這裡，但 route middleware 只看得到頁面路由，
 * API 的請求根本不會經過它——寫著是為了「規則的完整」與日後有別處引用這份清單時，
 * 不會有人以為健康檢查也要登入。
 */
const PUBLIC_PATHS = new Set([LOGIN_PATH, '/api/health'])

/**
 * `/auth/` 底下整段都是例外：OAuth 與訪客登入的 callback 正是在「還沒登入」的
 * 狀態下被打回來的，攔下來的話人永遠登不進去。
 */
const PUBLIC_PATH_PREFIXES = ['/auth/']

/** 去掉查詢字串、雜湊與結尾斜線，讓 `/log`、`/log/`、`/log?x=1` 是同一件事 */
function normalizePath(path: string): string {
  const withoutQuery = path.split('?')[0]!.split('#')[0]!

  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, '') || HOME_PATH : withoutQuery
}

/** 這個路徑不需登入就能開嗎 */
export function isPublicPath(path: string): boolean {
  const normalized = normalizePath(path)

  return PUBLIC_PATHS.has(normalized)
    || PUBLIC_PATH_PREFIXES.some(prefix => normalized.startsWith(prefix))
}

/**
 * 這張（解封之後的）密封 cookie 現在還算登入嗎。
 *
 * 收的是 `useUserSession().session` 的內容，也就是 `/api/_auth/session` 回來的東西：
 * 依 #64 定案，那裡面「只有 { userId, exp }」。
 *
 * 刻意不看 nuxt-auth-utils 自己的 `loggedIn`——它判斷的是 `session.user`，
 * 而我們的 payload 沒有那個欄位（不放個人資料進 cookie，要 email 時再查 DB），
 * 用它的話每個人都會被判成未登入。
 *
 * 也刻意不 import server/utils/session.ts 的 `readSessionPayload`：那一支是 server
 * 端的權威判定，屬於 #64 的認證程式碼。這裡是同一組規則的前端副本，判錯了只影響
 * 畫面跳不跳（見檔頭），所以寧可各自獨立，也不把 server 端的認證邏輯搬進瀏覽器。
 */
export function hasActiveSession(session: unknown, now: Date): boolean {
  if (typeof session !== 'object' || session === null) {
    return false
  }

  const { userId, exp } = session as { userId?: unknown, exp?: unknown }

  if (typeof userId !== 'string' || userId === '') {
    return false
  }

  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    return false
  }

  // 與 readSessionPayload 同一個判準：剛好到期的那一秒算過期。
  // 寧可早一秒把人送去登入頁，不要晚一秒讓他對著一頁 401 發呆。
  return exp > Math.floor(now.getTime() / 1000)
}

/**
 * 這一次導覽要不要改去別的地方？回傳目的地，不需要導向時回 null。
 *
 * 兩條規則，方向相反：
 *   - 未登入 → 除了例外路徑，一律先去 /login（不要先亮出半個空殼畫面）
 *   - 已登入 → /login 沒必要再看，回首頁
 *
 * 不做「登入後回到原本想去的頁面」：那需要把來源路徑一路帶過 OAuth 的往返，
 * 會動到 #64 的登入路由，超出本 issue 的範圍（issue 的「非目標」）。
 */
export function resolveAuthRedirect(input: { path: string, signedIn: boolean }): string | null {
  const normalized = normalizePath(input.path)

  if (!input.signedIn) {
    return isPublicPath(normalized) ? null : LOGIN_PATH
  }

  // 已登入的人踩到 /auth/* 是「再登入一次」（例如換一個 Google 帳號），不是走錯路
  return normalized === LOGIN_PATH ? HOME_PATH : null
}

/**
 * 這個 HTTP 狀態碼代表「你沒登入」嗎。
 *
 * 只認 401。403 是「登入了但不准」、404 是「沒這筆資料」——
 * 把它們一起導去登入頁，只會讓人再登入一次然後撞上同一面牆。
 */
export function isUnauthorizedStatus(status: number): boolean {
  return status === 401
}
