/**
 * 覆蓋整個畫面的那一層打開時，把底下那份文件的捲動停住。
 *
 * 沒有這把鎖，手指在遮罩上滑動會捲到背景頁面：儀表板停在原地、後面的內容卻在動，
 * 看起來像壞掉。鎖在 `<html>` 而不是 `<body>`：頁面靠 document 捲動
 * （`app/layouts/default.vue` 沒有任何 overflow 容器），首頁的 sticky 頁首也是看
 * `window.scrollY`——`overflow: hidden` 會留住目前的捲動位置，換成 `position: fixed`
 * 那套會把 scrollY 歸零，背景的頁首會在遮罩後面自己展開。
 *
 * 這把鎖只擋得住滾輪與捲軸。iOS Safari 的手指還會把位移接力給背景頁面，
 * 那一段要靠該層自己在 touchmove 上 `preventDefault`（見 WaterDashboardSheet）。
 *
 * 還原時寫回原本的 inline 值而不是直接清掉，別人先鎖上的才不會被我們解開。
 */
export function useScrollLock(locked: Ref<boolean> | ComputedRef<boolean>): void {
  // null＝這個呼叫端目前沒有上鎖，順便擋掉重複上鎖時把 'hidden' 記成「原本的值」
  let previousOverflow: string | null = null

  function lock() {
    if (previousOverflow !== null) {
      return
    }

    previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
  }

  function unlock() {
    if (previousOverflow === null) {
      return
    }

    document.documentElement.style.overflow = previousOverflow
    previousOverflow = null
  }

  watch(locked, (value) => {
    // 捲動只存在於瀏覽器；SSR 這一輪沒有 document 可鎖
    if (import.meta.server) {
      return
    }

    if (value) {
      lock()
      return
    }

    unlock()
  }, { immediate: true })

  // 換缸、離開頁面時整層連同鎖一起消失，鎖不能留在文件上
  onScopeDispose(unlock)
}
