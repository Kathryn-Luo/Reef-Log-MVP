/**
 * 首頁 sticky 頁首「要不要收合」的判斷（screen-1：向下捲動 → 頁首由 ~236px 收成 ~92px 兩層）。
 *
 * 收合是位置以外的樣態變化，需要知道捲到哪裡，所以由頁面把 window.scrollY 餵進來，
 * 門檻邏輯留在這裡——不開瀏覽器就驗得完。
 */

/** 捲過這個距離就收合。抓得比一次輕觸捲動大一點，指尖抖動不會誤觸發 */
export const HEADER_COLLAPSE_AT = 24

/** 已收合時，要回到這個距離「以內」才展開 */
export const HEADER_EXPAND_BELOW = 8

/**
 * @param scrollY  目前的捲動距離（iOS 橡皮筋回彈會給負值）
 * @param collapsed 目前是不是收合中——遲滯要靠它才判斷得出來
 *
 * 兩個門檻而不是一個：收合會讓頁首變矮、文件跟著變短，捲動位置正好落在門檻上時，
 * 單一門檻會收合→變短→展開→變長→收合地來回抖動。
 */
export function shouldCollapseHeader(scrollY: number, collapsed: boolean): boolean {
  return collapsed ? scrollY > HEADER_EXPAND_BELOW : scrollY >= HEADER_COLLAPSE_AT
}
