import { shouldCollapseHeader } from '#shared/utils/stickyHeader'

export interface HeaderCollapse {
  /** 頁首目前是不是收合中 */
  collapsed: Readonly<Ref<boolean>>
  /**
   * 過場是否已開放。首幀為 false——還原捲動位置的那一次要直接以最終樣態出現，
   * 不能先展開再演一次收合。
   */
  animated: Readonly<Ref<boolean>>
}

export interface HeaderCollapseOptions {
  /**
   * 過場要等到這個旗標為 true 之後才開放。
   *
   * 捲動位置的還原（issue #103）發生在「內容到齊」之後，比掛載晚上好幾秒，
   * 而補回去的那一次不能觸發過場。省略時掛載後就開放——沒有東西要還原的頁面，
   * 行為與這個選項存在之前相同。
   */
  until?: MaybeRefOrGetter<boolean>
  /**
   * 樣態要對齊的捲動位置；0（或省略）代表對齊當下的 `window.scrollY`。
   *
   * 還原捲動位置（issue #103）時給的是「等一下要補回去的位置」。頁首必須在那一捲
   * **之前**就擺成最終樣態：反過來的話收合會把文件上方抽掉約 108px，瀏覽器的
   * scroll anchoring 會把 scrollY 往回推同樣的距離，落點就永遠差那一段。
   */
  at?: MaybeRefOrGetter<number>
}

/**
 * 首頁 sticky 頁首的收合狀態：捲動時把 window.scrollY 交給 shouldCollapseHeader 判斷。
 *
 * 頁面靠 document 捲動（`app/layouts/default.vue` 沒有任何 overflow 容器），
 * 所以監聽的對象是 window。SSR 沒有 window，一律從展開開始。
 *
 * 收合的過場是 CSS 的事（class 一翻轉就播），這裡只負責狀態——
 * 動畫綁進 scroll handler 的話每次捲動都要重算，中階手機上會直接掉幀。
 */
export function useHeaderCollapse(options: HeaderCollapseOptions = {}): HeaderCollapse {
  const collapsed = ref(false)
  const animated = ref(false)
  let frame: number | null = null
  let stopGate: (() => void) | null = null
  let stopAt: (() => void) | null = null
  let opened = false

  function sync() {
    // 還原中就以「要補回去的位置」為準；還原不在進行中時它是 0，落回實際的捲動位置
    collapsed.value = shouldCollapseHeader(
      toValue(options.at) || window.scrollY,
      collapsed.value,
    )
  }

  function openTransitions() {
    if (opened) {
      return
    }

    opened = true

    // 還原剛落地：最終樣態要在開放過場之前先對齊
    sync()

    // 隔兩幀才開放過場：第一幀讓對齊後的樣態實際畫出來，第二幀才拆掉停用過場的旗標。
    // 只隔一幀的話，「對齊捲動位置」與「開放過場」有機會落在同一次樣式計算裡，
    // 還原捲動位置時仍會演一次收合。
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        animated.value = true
      })
    })
  }

  onMounted(() => {
    // 掛上就先對一次，不然要等使用者再捲一下頁首才會收合
    sync()

    // 只讀 scrollY、不呼叫 preventDefault，passive 讓捲動不必等這個 handler
    window.addEventListener('scroll', sync, { passive: true })

    // 還原的目標是在 useScrollRestore 的 onMounted 裡才定下來的，可能比這裡晚一步；
    // 之後放棄還原時它也會歸零。兩種變動都要讓樣態跟著重對一次
    stopAt = watch(() => toValue(options.at) ?? 0, sync)

    // 沒有 until 時，這一輪 immediate 就直接開放，與還原機制存在之前一樣
    stopGate = watch(() => toValue(options.until ?? true), (ready) => {
      if (ready) {
        openTransitions()
      }
    }, { immediate: true })
  })

  onBeforeUnmount(() => {
    if (frame !== null) {
      cancelAnimationFrame(frame)
    }

    stopGate?.()
    stopAt?.()
    window.removeEventListener('scroll', sync)
  })

  return { collapsed: readonly(collapsed), animated: readonly(animated) }
}
