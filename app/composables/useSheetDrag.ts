/**
 * 底部升起的面板「向下拖曳關閉」這個手勢（issue #120 抽出共用）。
 *
 * 原本整段長在 WaterDashboardSheet.vue 裡。「移動到其他缸」沿用同一組 sheet 語彙，
 * 那段 pointer / touch 的分流不該被抄第二份——它踩過的坑（見下方註解）也才只需要修一處。
 *
 * 呼叫端負責：
 *   - 把 `surfaceHandlers` 綁在覆蓋整個畫面的那一層（移動與放開收在那裡而不是把手上，
 *     手指或滑鼠拖出把手範圍也追得到）
 *   - 把 `handleHandlers` 綁在可拖曳的那一塊（把手＋標題），並給它 `touch-none`
 *   - 把 `panelStyle` 綁在面板上
 */

/** 拖到這個距離放開才算「要關掉」。太短會讓輕輕一碰就關掉，太長則要拖過半個畫面 */
const DRAG_CLOSE_DISTANCE = 60

export interface SheetDragOptions {
  /** 拖曳距離足夠時要做的事 */
  onClose: () => void
  /**
   * 面板內唯一捲得動的那一段（CSS selector）。
   *
   * 這一段以外的垂直位移在 iOS 上會被接力去捲背景頁面——`overflow: hidden` 攔不住它，
   * 只有在 touchmove 上 preventDefault 才停得下來。沒有可捲區的面板不必給。
   */
  scrollArea?: string
}

export function useSheetDrag({ onClose, scrollArea }: SheetDragOptions) {
  const dragStartY = ref<number | null>(null)
  const dragOffset = ref(0)

  // 拖曳中才寫 inline style：沒在拖的時候留著 transform 會蓋掉升起 / 收合的過場
  const panelStyle = computed(() =>
    dragOffset.value > 0 ? { transform: `translateY(${dragOffset.value}px)` } : undefined,
  )

  function isInsideScrollArea(target: EventTarget | null): boolean {
    return Boolean(scrollArea) && target instanceof Element && target.closest(scrollArea!) !== null
  }

  function beginDrag(clientY: number) {
    dragStartY.value = clientY
    dragOffset.value = 0
  }

  function trackDrag(clientY: number) {
    if (dragStartY.value === null) {
      return
    }

    // 只跟著往下走。往上拖沒有對應的動作，跟上去只會把面板拉出畫面上緣
    dragOffset.value = Math.max(0, clientY - dragStartY.value)
  }

  function finishDrag(clientY: number) {
    const startY = dragStartY.value

    dragStartY.value = null
    dragOffset.value = 0

    if (startY !== null && clientY - startY >= DRAG_CLOSE_DISTANCE) {
      onClose()
    }
  }

  /** 拖曳被系統收走（來電、手勢接管）時當作沒拖過，不要留在半路 */
  function abandonDrag() {
    dragStartY.value = null
    dragOffset.value = 0
  }

  // ── 觸控與滑鼠走兩條路 ─────────────────────────────────────────
  //
  // 只綁 pointer events 的話，iPhone Safari 拖不動：WebKit 的手勢辨識器一旦認定
  // 這段垂直位移屬於捲動，就會收走觸控指標並補一個 pointercancel，
  // 手指還在螢幕上，拖曳卻已經無聲地結束了。滑鼠不走那條路，所以桌機三個瀏覽器都正常。
  //
  // 因此觸控改由 touch events 驅動（iOS 上不會被這樣收走），pointer events 只留給
  // 滑鼠與觸控筆。兩條路徑互不重疊，也就不會有「一次拖曳關兩次」的問題，
  // 而 WebKit 送來的 pointercancel 也再也打斷不了正在進行的觸控拖曳。

  function isTouch(event: PointerEvent) {
    return event.pointerType === 'touch'
  }

  function startPointerDrag(event: PointerEvent) {
    if (isTouch(event)) {
      return
    }

    beginDrag(event.clientY)
  }

  function movePointerDrag(event: PointerEvent) {
    if (isTouch(event)) {
      return
    }

    trackDrag(event.clientY)
  }

  function endPointerDrag(event: PointerEvent) {
    if (isTouch(event)) {
      return
    }

    finishDrag(event.clientY)
  }

  function cancelPointerDrag(event: PointerEvent) {
    if (isTouch(event)) {
      return
    }

    abandonDrag()
  }

  // 追蹤的那一根手指。多點觸控時後落下的手指不該把座標換過去
  const dragTouchId = ref<number | null>(null)

  function trackedTouch(event: TouchEvent): Touch | undefined {
    if (dragTouchId.value === null) {
      return undefined
    }

    return Array.from(event.changedTouches).find(touch => touch.identifier === dragTouchId.value)
  }

  function startTouchDrag(event: TouchEvent) {
    const touch = event.changedTouches[0]

    if (!touch || dragTouchId.value !== null) {
      return
    }

    dragTouchId.value = touch.identifier
    beginDrag(touch.clientY)
  }

  function moveTouchDrag(event: TouchEvent) {
    const touch = trackedTouch(event)

    // cancelable 為 false 代表瀏覽器已經決定要捲，攔也沒用
    if (!touch) {
      // 沒在拖曳的手指：只有可捲的那一段該滑得動。其餘位置的垂直位移在 iOS 上
      // 會被接力去捲背景頁面，只有在這裡 preventDefault 才停得下來。
      if (!isInsideScrollArea(event.target) && event.cancelable) {
        event.preventDefault()
      }

      return
    }

    // 拖曳區上的 touch-action: none 只擋住手勢的起點；不在這裡攔下原生行為，
    // Safari 還是會把這段位移拿去捲頁面或做邊緣回彈。
    if (event.cancelable) {
      event.preventDefault()
    }

    trackDrag(touch.clientY)
  }

  function endTouchDrag(event: TouchEvent) {
    const touch = trackedTouch(event)

    if (!touch) {
      return
    }

    dragTouchId.value = null
    finishDrag(touch.clientY)
  }

  function cancelTouchDrag(event: TouchEvent) {
    if (!trackedTouch(event)) {
      return
    }

    dragTouchId.value = null
    abandonDrag()
  }

  return {
    panelStyle,
    /** 綁在覆蓋整個畫面的那一層 */
    surfaceHandlers: {
      pointermove: movePointerDrag,
      pointerup: endPointerDrag,
      pointercancel: cancelPointerDrag,
      touchmove: moveTouchDrag,
      touchend: endTouchDrag,
      touchcancel: cancelTouchDrag,
    },
    /** 綁在可拖曳的那一塊（把手＋標題） */
    handleHandlers: {
      pointerdown: startPointerDrag,
      touchstart: startTouchDrag,
    },
  }
}
