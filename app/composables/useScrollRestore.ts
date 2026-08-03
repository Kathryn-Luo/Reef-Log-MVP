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
  /**
   * 等一下要補回去的位置；0 代表沒有東西要補（含已經補完）。
   *
   * 頁面拿它當「樣態要對齊的位置」（`useHeaderCollapse` 的 `at`）。捲過去之後
   * 才讓頁首收合的話，收合會把文件上方抽掉約 108px，瀏覽器的 scroll anchoring
   * 為了讓眼前的內容不跳動會把 scrollY 往回推同樣的距離，補回去的位置就永遠差
   * 那一段。順序因此必須是「先擺成最終樣態，再捲過去」。
   */
  pending: Readonly<Ref<number>>
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
  const pending = ref(0)
  let frame: number | null = null

  function remember() {
    writeMark(key, { top: window.scrollY, document: DOCUMENT_ID })
  }

  /**
   * 還原處理完：不管是補回去了、放棄了、還是根本沒東西要補。
   *
   * 收尾一律重設存檔。少了這一步就會留下「舊文件寫的、位置不是 0」的存檔——
   * 這一次沒用到它（同文件返回、或等不到內容而放棄），下一次重新整理卻會把它
   * 當成「重新整理前的位置」補回去，把停在頂端的人拉走。
   */
  function finish() {
    frame = null
    // 樣態的依據交還給實際的捲動位置：補完了兩者一致，放棄了則要擺回頂端的樣子
    pending.value = 0
    remember()
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

    // 先讓等著看它的人（頁首）擺成還原後的樣態，再開始等文件長高。
    // 捲過去的那一刻上方的高度已經定案，就沒有東西可以把落點推走
    pending.value = target

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
        // finish() 會把這個位置記成「這一份文件」寫的，之後在站內換頁回來不會再被補一次
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

  return { settled: readonly(settled), pending: readonly(pending) }
}
