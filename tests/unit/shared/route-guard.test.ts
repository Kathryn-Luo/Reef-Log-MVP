// @vitest-environment node
// 純函式，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it } from 'vitest'
import {
  HOME_PATH,
  LOGIN_PATH,
  hasActiveSession,
  isPublicPath,
  isUnauthorizedStatus,
  resolveAuthRedirect,
} from '../../../shared/utils/routeGuard'

// 路由保護的判斷規則（issue #67）。
//
// 這一支測的是「該不該導向、導去哪裡」這個決定本身，所有分支都在這裡驗；
// middleware 與 plugin 那兩層只剩接線，由 auth-middleware.test.ts 與
// route-guard-wiring.test.ts 顧。

/** issue 的「要保護的頁面（依 app/pages 現況）」清單 */
const PROTECTED_PATHS = [
  '/',
  '/log',
  '/trends',
  '/maintenance',
  '/creatures',
  '/creatures/new',
  '/creatures/f5',
  '/tanks/new',
]

/** issue 的「例外（不需登入）」清單 */
const PUBLIC_PATHS = [
  '/login',
  '/auth/google',
  '/auth/guest',
  '/api/health',
]

const NOW = new Date('2026-07-31T00:00:00.000Z')

/** 密封 cookie 解開後的內容，形狀與 server/utils/session.ts 的 SessionPayload 一致 */
function payload(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    exp: Math.floor(NOW.getTime() / 1000) + 60,
    ...overrides,
  }
}

describe('hasActiveSession', () => {
  it('cookie 裡有 userId 且尚未過期時視為已登入', () => {
    expect(hasActiveSession(payload(), NOW)).toBe(true)
  })

  // 未登入時 /api/_auth/session 回的是空物件，不是 null——兩種都要接得住
  it.each([
    ['沒有 session', null],
    ['session 讀取失敗', undefined],
    ['空的 session', {}],
  ])('%s 時視為未登入', (_case, session) => {
    expect(hasActiveSession(session, NOW)).toBe(false)
  })

  it('userId 不是非空字串時視為未登入', () => {
    expect(hasActiveSession(payload({ userId: '' }), NOW)).toBe(false)
    expect(hasActiveSession(payload({ userId: 42 }), NOW)).toBe(false)
  })

  // 與 server/utils/session.ts 的 readSessionPayload 同一個判準：
  // 用 <= 而不是 <，剛好到期的那一秒算過期。寧可早一秒登出，不要晚一秒。
  it('exp 已經過了（含剛好到期的那一秒）時視為未登入', () => {
    const expiredAt = Math.floor(NOW.getTime() / 1000)

    expect(hasActiveSession(payload({ exp: expiredAt - 1 }), NOW)).toBe(false)
    expect(hasActiveSession(payload({ exp: expiredAt }), NOW)).toBe(false)
  })

  it('沒有 exp 或 exp 不是數字時視為未登入', () => {
    expect(hasActiveSession({ userId: 'user-1' }, NOW)).toBe(false)
    expect(hasActiveSession(payload({ exp: 'soon' }), NOW)).toBe(false)
  })

  // nuxt-auth-utils 自己的 `loggedIn` 看的是 session.user，而我們的密封 cookie
  // 裡「只有 { userId, exp }」（#64 定案，見 auth-wiring.test.ts）。認那個欄位的話，
  // 判斷的就不是我們自己發出的那張 cookie 了。
  it('只有 nuxt-auth-utils 慣用的 user 欄位、沒有 userId 時仍視為未登入', () => {
    expect(hasActiveSession({ user: { id: 'user-1' } }, NOW)).toBe(false)
  })
})

describe('isPublicPath', () => {
  it.each(PUBLIC_PATHS)('%s 不需登入', (path) => {
    expect(isPublicPath(path)).toBe(true)
  })

  it.each(PROTECTED_PATHS)('%s 需要登入', (path) => {
    expect(isPublicPath(path)).toBe(false)
  })

  // 例外是白名單，比對的是「整段路徑」而不是開頭幾個字。
  // 前綴比對會讓 /loginish 這種路徑白白繞過保護。
  it('名字以例外路徑開頭、但不是例外本身的路徑仍需登入', () => {
    expect(isPublicPath('/loginish')).toBe(false)
    expect(isPublicPath('/authors')).toBe(false)
  })

  it('查詢字串、雜湊與結尾斜線不影響判斷', () => {
    expect(isPublicPath('/login?next=/log')).toBe(true)
    expect(isPublicPath('/login/')).toBe(true)
    expect(isPublicPath('/auth/google#state')).toBe(true)
    expect(isPublicPath('/log/')).toBe(false)
  })
})

describe('resolveAuthRedirect', () => {
  // Given 我沒有登入 / When 我開啟首頁 / Then 我被導向 /login
  // Given 我沒有登入 / When 我開啟 /log、/trends、/creatures… / Then 我被導向 /login
  it.each(PROTECTED_PATHS)('未登入開 %s 時導向 /login', (path) => {
    expect(resolveAuthRedirect({ path, signedIn: false })).toBe(LOGIN_PATH)
  })

  // 例外路徑不被攔：擋住 /login 本身會變成「導向自己」的無限迴圈，
  // 擋住 /auth/* 則會讓人永遠登不進來——OAuth 的 callback 正是在未登入狀態下打回來的。
  it.each(PUBLIC_PATHS)('未登入開 %s 時不導向', (path) => {
    expect(resolveAuthRedirect({ path, signedIn: false })).toBeNull()
  })

  // Given 我已登入 / When 我開啟上述任何需要資料的頁面 / Then 正常顯示
  it.each(PROTECTED_PATHS)('已登入開 %s 時不導向', (path) => {
    expect(resolveAuthRedirect({ path, signedIn: true })).toBeNull()
  })

  // Given 我已登入 / When 我開啟 /login / Then 我被導向首頁
  it('已登入開 /login 時導回首頁', () => {
    expect(resolveAuthRedirect({ path: LOGIN_PATH, signedIn: true })).toBe(HOME_PATH)
  })

  // 已登入的人踩到 OAuth 起點是「再登入一次」，不是「該被趕走」——
  // 換一個 Google 帳號登入就會走這條路，攔下來的話那件事永遠做不到。
  it('已登入開 /auth/* 時不導向', () => {
    expect(resolveAuthRedirect({ path: '/auth/google', signedIn: true })).toBeNull()
  })

  // 保護是預設值：清單沒列到的新頁面（例如還沒建的 /creatures/new）
  // 也要先擋下來。漏掉一頁的代價是別人的資料被看見，反過來只是多按一次登入。
  it('未登入開清單以外的新頁面時仍導向 /login', () => {
    expect(resolveAuthRedirect({ path: '/creatures/new', signedIn: false })).toBe(LOGIN_PATH)
    expect(resolveAuthRedirect({ path: '/somewhere/else', signedIn: false })).toBe(LOGIN_PATH)
  })

  it('結尾斜線與查詢字串不影響判斷', () => {
    expect(resolveAuthRedirect({ path: '/log/', signedIn: false })).toBe(LOGIN_PATH)
    expect(resolveAuthRedirect({ path: '/login/', signedIn: true })).toBe(HOME_PATH)
    expect(resolveAuthRedirect({ path: '/login?next=/log', signedIn: false })).toBeNull()
  })
})

describe('isUnauthorizedStatus', () => {
  // Given 我的 session 已過期 / When 我在頁面上操作並收到 401 / Then 我被導向 /login
  it('401 是「這個人沒登入」', () => {
    expect(isUnauthorizedStatus(401)).toBe(true)
  })

  // 403 是「登入了但不准」、404 是「沒這筆資料」，兩者都不該把人踢去登入頁——
  // 已經登入的人被踢回登入頁，只會再登入一次然後撞上同一面牆。
  it.each([400, 403, 404, 500])('%i 不是', (status) => {
    expect(isUnauthorizedStatus(status)).toBe(false)
  })
})
