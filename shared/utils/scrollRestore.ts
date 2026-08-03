/**
 * 捲動位置還原的存檔格式與判斷（issue #103）。
 *
 * SPA（#84）之後瀏覽器的捲動位置還原永遠落空：還原發生在 `load` 當下，而那一刻
 * 文件只有一個 viewport 高，沒有位置可以還原；等資料到齊、文件變長時瀏覽器不會再
 * 回頭補，於是捲到一半重新整理就回到頂端。還原的責任因此移到我們自己身上。
 *
 * 這裡放不需要瀏覽器就驗得完的那一半——key、存檔格式、「這一筆存檔要不要還原」、
 * 「現在補得回去嗎」。時序那一半在 `app/composables/useScrollRestore.ts`。
 */

/** 存檔一律放在同一個前綴底下，清掉時看得出是誰留的 */
export const SCROLL_RESTORE_PREFIX = 'reef:scroll:'

export interface ScrollMark {
  /** 存檔當下的捲動位置 */
  top: number
  /** 寫下這筆存檔的文件識別碼——用來分辨「重新整理前」與「同一份文件內」 */
  document: string
}

/** 每個路由一份：從別的頁面回來時，補回去的要是這一頁自己的位置 */
export function scrollRestoreKey(path: string): string {
  return `${SCROLL_RESTORE_PREFIX}${path}`
}

export function serializeScrollMark(mark: ScrollMark): string {
  return JSON.stringify(mark)
}

/**
 * 讀回一筆存檔；讀不出來就是 null。
 *
 * sessionStorage 是使用者改得動的地方，壞掉的內容只代表「沒有位置可還原」，
 * 不該讓頁面跟著壞——還原是加分功能。
 */
export function parseScrollMark(raw: string | null): ScrollMark | null {
  if (!raw) {
    return null
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  }
  catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }

  const { top, document } = parsed as Partial<ScrollMark>

  if (typeof top !== 'number' || !Number.isFinite(top) || typeof document !== 'string') {
    return null
  }

  return { top, document }
}

/**
 * 這一筆存檔要還原到哪裡；0 代表不還原。
 *
 * 同一份文件寫的存檔一律不還原：那是 SPA 內部換頁留下的，換頁後的捲動位置歸
 * router 管。我們只補「重新整理／再次開啟」跨文件的那一次——否則從別的 tab 回到
 * 首頁會被拉回上一次的位置，那不是這個 issue 要修的行為。
 */
export function restoreTarget(mark: ScrollMark | null, currentDocument: string): number {
  if (!mark || mark.document === currentDocument || mark.top <= 0) {
    return 0
  }

  return mark.top
}

/**
 * 文件已經長到足以容納那個位置了嗎。
 *
 * 不夠高就捲過去只會被瀏覽器夾回頂端——那正是這個 issue 的成因，
 * 所以還原的時機看的是這個條件，不是掛載當下、也不是一段固定的等待。
 */
export function canRestoreTo(target: number, scrollHeight: number, viewportHeight: number): boolean {
  return scrollHeight - viewportHeight >= target
}
