import { computed, ref } from 'vue'
import { SESSION_MAX_AGE_SECONDS } from '../../../server/utils/session'

// 測試用的「已登入」身分（issue #67）。
//
// 為什麼需要它：路由保護是全域 middleware，mountSuspended 掛載元件前會真的導覽一次，
// 未登入的話那次導覽會被導去 /login，元件就拿不到自己該有的路由（例如
// `/creatures/f5` 的 :id、底部 tab 的選中狀態）。
//
// 各測試檔用法：
//   mockNuxtImport('useUserSession', () => () => signedInUserSession())
//
// 內層那一圈刻意留成 arrow：mockNuxtImport 的 factory 會被提升到 import 之前，
// 直接把這裡的識別字當成回傳值有機會踩到 TDZ；包一層之後，取值發生在真的被呼叫時。

/** 這個測試檔要用的使用者。單一測試裡只有一位，取什麼 id 不影響斷言。 */
export const SIGNED_IN_USER_ID = 'user-1'

/**
 * 一張現在還有效的密封 cookie 內容。形狀與 server/utils/session.ts 的 SessionPayload
 * 一致——「只有 { userId, exp }」是 #64 的定案，夾具跟著那個定案走，
 * 免得哪天 payload 變了，這裡卻還在餵一個早就不存在的形狀。
 *
 * exp 由現在往後推，測試跑多久都不會中途過期。
 */
export function signedInSession() {
  return {
    userId: SIGNED_IN_USER_ID,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  }
}

/**
 * `useUserSession()` 的替身。
 *
 * 除了 `session` 之外的欄位不是湊數的：nuxt-auth-utils 自己的 plugin 會在 App 啟動時
 * 呼叫 `fetch()`（把 /api/_auth/session 讀進狀態）。少了它，那支 plugin 會拋錯，
 * 排在後面的 plugin——包含本輪新增的 `$api`——就整組不會被安裝，
 * 頁面於是拿不到任何資料，錯誤還跟認證看起來毫無關係。
 *
 * 每次呼叫都回傳新的一份：測試之間不共用狀態，某一題觸發的 401（$api 會把
 * session 清成 null）不會滲到下一題。
 */
export function signedInUserSession() {
  const session = ref<unknown>(signedInSession())

  return {
    ready: computed(() => true),
    loggedIn: computed(() => true),
    user: computed(() => null),
    session,
    fetch: async () => {},
    clear: async () => {},
    openInPopup: () => {},
  }
}
