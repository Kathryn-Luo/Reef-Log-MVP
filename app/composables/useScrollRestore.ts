import type { ScrollMark } from '#shared/utils/scrollRestore'
import {
  canRestoreTo,
  parseScrollMark,
  restoreTarget,
  scrollRestoreKey,
  serializeScrollMark,
} from '#shared/utils/scrollRestore'

export interface ScrollRestore {
  /**
   * 還原已經處理完：位置補回去了，或確定沒有東西要補。
   *
   * 頁面拿它當「現在可以開始演過場了」的訊號（`useHeaderCollapse` 的 `until`）——
   * 補回去的那一次捲動不能觸發過場，否則使用者會看到頁首演一遍收合。
   */
  settled: Readonly<Ref<boolean>>
}

/**
 * 等內容到齊的上限，60fps 下約 10 秒。
 *
 * 觀測到的空窗期是 3.8 秒（issue #98 的題目），這裡留了兩倍以上的餘裕。
 * 等不到就放棄、停在頂端——不能無限等下去，那會讓等著 `settled` 的頁首永遠不開放過場。
 */
export const SCROLL_RESTORE_MAX_FRAMES = 600

/**
 * 這一份文件的識別碼。
 *
 * 存檔帶著它，讀的時候才分得出這筆是「上一份文件（重新整理前）」還是自己剛寫的。
 * SPA 內部換頁不換文件，識別碼因此相同——那種情況不還原。
 */
const DOCUMENT_ID = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

/** sessionStorage 在隱私模式下會直接丟例外，讀寫一律當作「沒有存檔」處理 */
function readMark(key: string): ScrollMark | null {
  try {
    return parseScrollMark(window.sessionStorage.getItem(key))
  }
  catch {
    return null
  }
}

function writeMark(key: string, mark: ScrollMark): void {
  try {
    window.sessionStorage.setItem(key, serializeScrollMark(mark))
  }
  catch {
    // 存不進去只是下一次重新整理回到頂端，不值得讓整頁壞掉
  }
}

/**
 * 自己接手捲動位置的還原（issue #103）。
 *
 * 瀏覽器做不到的是時序：它在 `load` 當下還原，而那一刻 SPA 的文件只有一個 viewport
 * 高，無處可還原。所以這裡逐幀等「文件長到足以容納那個位置」才補回去——固定的
 * `setTimeout` 會在慢的時候失效、在快的時候閃一下。
 *
 * 位置存在 sessionStorage（每個路由一份），刻意不寫進網址：網址是使用者會複製、
 * 會分享的東西，捲動位置不該跟著跑。
 */
export function useScrollRestore(): ScrollRestore {
  const route = useRoute()
  const key = scrollRestoreKey(route.path)
  const settled = ref(false)
  let frame: number | null = null

  function remember() {
    writeMark(key, { top: window.scrollY, document: DOCUMENT_ID })
  }

  function finish() {
    frame = null
    settled.value = true
  }

  onMounted(() => {
    // 存檔一路都要寫：這一次還不還原，都不影響下一次重新整理要補回哪裡。
    // 只讀 scrollY，passive 讓捲動不必等這個 handler
    window.addEventListener('scroll', remember, { passive: true })

    const target = restoreTarget(readMark(key), DOCUMENT_ID)

    if (!target) {
      finish()

      return
    }

    // 進站當下的位置：使用者在等待期間自己捲動的話，控制權就交還給他們
    const startedAt = window.scrollY
    let waited = 0

    function step() {
      if (window.scrollY !== startedAt) {
        finish()

        return
      }

      if (canRestoreTo(target, document.documentElement.scrollHeight, window.innerHeight)) {
        window.scrollTo({ top: target, behavior: 'instant' })
        // 這個位置現在是「這一份文件」寫的了，之後在站內換頁回來不會再被補一次
        remember()
        finish()

        return
      }

      if (++waited >= SCROLL_RESTORE_MAX_FRAMES) {
        finish()

        return
      }

      frame = requestAnimationFrame(step)
    }

    frame = requestAnimationFrame(step)
  })

  onBeforeUnmount(() => {
    if (frame !== null) {
      cancelAnimationFrame(frame)
    }

    window.removeEventListener('scroll', remember)
  })

  return { settled: readonly(settled) }
}
