import { shouldCollapseHeader } from '#shared/utils/stickyHeader'

/**
 * 首頁 sticky 頁首的收合狀態：捲動時把 window.scrollY 交給 shouldCollapseHeader 判斷。
 *
 * 頁面靠 document 捲動（`app/layouts/default.vue` 沒有任何 overflow 容器），
 * 所以監聽的對象是 window。SSR 沒有 window，一律從展開開始。
 */
export function useHeaderCollapse(): Readonly<Ref<boolean>> {
  const collapsed = ref(false)

  function sync() {
    collapsed.value = shouldCollapseHeader(window.scrollY, collapsed.value)
  }

  onMounted(() => {
    // 重新整理或返回上一頁時瀏覽器會還原捲動位置，掛上就先對一次，
    // 不然要等使用者再捲一下頁首才會收合
    sync()

    // 只讀 scrollY、不呼叫 preventDefault，passive 讓捲動不必等這個 handler
    window.addEventListener('scroll', sync, { passive: true })
  })

  onBeforeUnmount(() => {
    window.removeEventListener('scroll', sync)
  })

  return readonly(collapsed)
}
