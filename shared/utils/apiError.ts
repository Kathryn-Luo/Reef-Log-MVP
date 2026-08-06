// API 失敗時「有沒有話可以直接說給使用者聽」。
//
// 說得出原因的失敗（例如「目前沒有可用的使用者」「死亡日不能早於入缸日」）都把
// 可以直接顯示的中文放在 `createError` 的 `data.message`——statusMessage 過不了
// h3 的 ASCII 過濾，讀它只會拿到 'No current user' 這種給不了使用者任何幫助的字串。
// 連不上或 500 這類說不出原因的，退回呼叫端給的通用訊息。

/**
 * 取值要往下鑽兩層：FetchError 的 `data` 是「整包回應內容」
 * （`{ statusCode, statusMessage, data }`），我們要的那則在它的 `data.message`。
 */
export function apiErrorMessage(cause: unknown, fallback: string): string {
  const body = (cause as { data?: { data?: { message?: unknown } } })?.data
  const message = body?.data?.message

  return typeof message === 'string' && message.trim() ? message : fallback
}

/**
 * 這次失敗的 HTTP 狀態碼，取不到時回 null（issue #132）。
 *
 * 「這一筆不存在」（404）與「拿不到資料」（500 / 離線 / function 掛掉）要分開處理，
 * 而分得開的前提是看得到狀態碼。ofetch 把它掛在 FetchError 的 `statusCode` 上，
 * 同一個值也在 `response.status`；連線根本沒送出去時兩者都沒有，那就是 null——
 * 而 null 屬於「說不出原因的失敗」那一邊，不是 404。
 */
export function apiErrorStatus(cause: unknown): number | null {
  const { statusCode, response } = (cause ?? {}) as {
    statusCode?: unknown
    response?: { status?: unknown }
  }

  if (typeof statusCode === 'number') {
    return statusCode
  }

  return typeof response?.status === 'number' ? response.status : null
}
