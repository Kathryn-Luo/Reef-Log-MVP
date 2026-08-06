import type { AsyncDataRequestStatus } from '#app'

/**
 * 「這一頁的資料拿不到」這件事的狀態（issue #132）。
 *
 * 三頁的 useAsyncData 各有一到兩支請求，判斷與重試的寫法一模一樣，所以連同
 * 一個容易寫錯的細節一起收在這裡（錯誤區塊本身是 LoadErrorState.vue）。
 *
 * ── 那個容易寫錯的細節：重試期間 ──
 *
 * `refresh()` 會把 status 從 'error' 翻成 'pending'，所以只寫
 * `status === 'error'` 的話，錯誤區塊會在請求還在路上的那一段被拆掉，
 * 畫面於是閃過一次空狀態——正是本 issue 要根除的那一幕，只是變短了。
 * 因此重試進行中一律仍視為 failed：要嘛換成資料，要嘛留在錯誤畫面上，
 * 中間不經過「你沒有資料」。
 */
export interface LoadFailure {
  /** 這一刻要不要改畫「載入失敗」 */
  failed: ComputedRef<boolean>
  /** 重試進行中（按鈕轉圈並按不下去，連按不會疊出好幾輪同樣的請求） */
  retrying: Readonly<Ref<boolean>>
  /** 重新發出同一批請求 */
  retry: () => Promise<void>
}

/**
 * @param statuses 這一頁所有 useAsyncData 的 status。任何一支失敗就算整頁失敗——
 *   半頁真資料配半頁空狀態比整頁錯誤更難看懂。
 * @param reload 重新發出同一批請求。一律「全部重打」而不是只重打失敗的那一支：
 *   只重打其中一支的話，另一支失敗時按幾次都救不回來。
 */
export function useLoadFailure(
  statuses: Ref<AsyncDataRequestStatus>[],
  reload: () => Promise<unknown>,
): LoadFailure {
  const retrying = ref(false)

  const failed = computed(() =>
    retrying.value || statuses.some(status => status.value === 'error'),
  )

  async function retry() {
    retrying.value = true

    try {
      await reload()
    }
    catch {
      // 重試又失敗了本來就是這裡要表達的狀態，status 已經記著，不必再處理。
      // 攔下來是因為這支函式掛在 @retry 上，讓它 reject 只會變成未處理的錯誤。
    }
    finally {
      retrying.value = false
    }
  }

  return { failed, retrying: readonly(retrying), retry }
}
