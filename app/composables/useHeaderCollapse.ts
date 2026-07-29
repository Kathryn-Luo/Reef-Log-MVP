import { shouldCollapseHeader } from '#shared/utils/stickyHeader'

export interface HeaderCollapse {
  /** 頁首目前是不是收合中 */
  collapsed: Readonly<Ref<boolean>>
  /**
   * 過場是否已開放。首幀為 false——瀏覽器還原捲動位置的那一次要直接以最終樣態出現，
   * 不能先展開再演一次收合。
   */
  animated: Readonly<Ref<boolean>>
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
export function useHeaderCollapse(): HeaderCollapse {
  const collapsed = ref(false)
  const animated = ref(false)
  let frame: number | null = null

  function sync() {
    collapsed.value = shouldCollapseHeader(window.scrollY, collapsed.value)
  }

  onMounted(() => {
    // 重新整理或返回上一頁時瀏覽器會還原捲動位置，掛上就先對一次，
    // 不然要等使用者再捲一下頁首才會收合
    sync()

    // 隔兩幀才開放過場：第一幀讓對齊後的樣態實際畫出來，第二幀才拆掉停用過場的旗標。
    // 只隔一幀的話，「對齊捲動位置」與「開放過場」有機會落在同一次樣式計算裡，
    // 還原捲動位置時仍會演一次收合。
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        animated.value = true
      })
    })

    // 只讀 scrollY、不呼叫 preventDefault，passive 讓捲動不必等這個 handler
    window.addEventListener('scroll', sync, { passive: true })
  })

  onBeforeUnmount(() => {
    if (frame !== null) {
      cancelAnimationFrame(frame)
    }

    window.removeEventListener('scroll', sync)
  })

  return { collapsed: readonly(collapsed), animated: readonly(animated) }
}
