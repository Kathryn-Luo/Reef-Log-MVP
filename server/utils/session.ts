// 密封 cookie session 的「內容規則」（issue #64、Epic #47 第 2 節定案）。
//
// 這裡「只有規則、沒有密碼學」——密封與解封（seal / unseal）本身要靠
// `nuxt-auth-utils`，而那個套件目前尚未安裝（見 PR #64 的說明）。
// 兩件事拆開有兩個好處：
//   1. 規則測得起來：過期判定、欄位形狀這些會出錯的地方全部在這一層；
//   2. 套件裝上之後，接線只是「unseal 出來的東西丟給 readSessionPayload」，
//      不必再回頭改判定邏輯。
//
// 刻意「不」自行實作密封：手寫簽章 / 加密是新增一份沒人 review 過的密碼學程式碼，
// 比等一個已核准的套件差得多。

/**
 * 密封 cookie 的內容。刻意就這兩個欄位，不放個人資料。
 *
 * 寫成 type 而不是 interface 是有原因的：`replaceUserSession()` 收的型別帶有索引簽章
 * （`UserSession` 上的 `[key: string]: unknown`），而 interface 不會被視為滿足索引簽章，
 * type alias 才會。用 interface 的話這個 payload 傳不進去。
 */
export type SessionPayload = {
  /** User.id。要 email / displayName 時以它查資料庫，不放進 cookie。 */
  userId: string
  /** 到期時間（Unix 秒）。 */
  exp: number
}

/**
 * session 有效期（秒）。
 *
 * schema.prisma 刻意沒有 Session 表：驗簽即得身分、不查 DB，代價是「無法提前撤銷」。
 * 已定案的緩解手段就是把有效期壓短（配合日後的 refresh 輪替），所以這個常數是那個
 * 取捨的一部分，不是隨手填的預設值。
 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

/**
 * 產生要放進密封 cookie 的內容。
 * 呼叫端傳入 `now` 而不是在這裡讀時鐘，測試才控得住到期時間。
 */
export function buildSessionPayload(
  userId: string,
  now: Date,
  maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS,
): SessionPayload {
  return {
    userId,
    exp: Math.floor(now.getTime() / 1000) + maxAgeSeconds,
  }
}

/**
 * 驗讀密封 cookie 的內容：形狀不對或已過期一律回 null（＝未登入）。
 *
 * 「簽章驗不過」不在這裡判斷——那一步在 unseal，失敗時根本給不出 payload，
 * 傳進來會是 undefined，走的是下面第一個 return。這裡守的是「解得開、但內容不對」：
 * 換過 payload 版本、或 cookie 被截斷成半個物件。
 *
 * 整段判定都是純運算，沒有任何資料庫查詢——這正是第 2 節選密封 cookie 的理由之一。
 */
export function readSessionPayload(raw: unknown, now: Date): SessionPayload | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }

  const { userId, exp } = raw as Partial<SessionPayload>

  if (typeof userId !== 'string' || userId === '') {
    return null
  }

  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    return null
  }

  // 用 > 而非 >=：剛好到期的那一秒算過期。寧可早一秒登出，不要晚一秒。
  if (exp <= Math.floor(now.getTime() / 1000)) {
    return null
  }

  return { userId, exp }
}
