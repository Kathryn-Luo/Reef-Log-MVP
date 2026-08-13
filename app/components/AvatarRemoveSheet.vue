<script setup lang="ts">
// 「移除頭像？」的確認（issue #168 的 4g）。
//
// 沿用 WaterDashboardSheet / CreatureMoveSheet 的 bottom sheet 語彙：底部升起、
// 半透明遮罩、頂端拖曳握把。移除是破壞性但可復原的動作（再上傳一張就好），
// 所以只要一步確認，不必打字重述。
//
// 狀態由 Profile 頁持有（開沒開、送不送得出去），與另外兩個 sheet 同一個分工：
// 放在這裡的話「移除中」會有兩份，而真正發請求的是頁面。
const props = defineProps<{
  open: boolean
  removing: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: []
}>()

const titleId = useId()
const descriptionId = useId()

/** 送出中一律不關：請求已經在路上，收掉畫面只會讓人不知道它到底成了沒有 */
function close() {
  if (!props.removing) {
    emit('close')
  }
}

function confirm() {
  if (!props.removing) {
    emit('confirm')
  }
}

// 展開時把底下那份文件鎖住，不然手指在遮罩上滑動會捲到背景頁面
useScrollLock(computed(() => props.open))

// 向下拖曳關閉。這個 sheet 沒有捲得動的區段，所以不必給 scrollArea
const { panelStyle, surfaceHandlers, handleHandlers } = useSheetDrag({ onClose: close })

// 展開時把焦點移進來，Esc 才收得到；收合時還給原本那個元素（「移除頭像」那顆），
// 不然關掉之後鍵盤焦點會掉回 body
const rootEl = ref<HTMLElement | null>(null)
const returnFocusTo = ref<HTMLElement | null>(null)

watch(() => props.open, async (open) => {
  // 焦點只存在於瀏覽器；SSR 這一輪沒有 document 可問
  if (import.meta.server) {
    return
  }

  if (open) {
    returnFocusTo.value = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    rootEl.value?.focus()
    return
  }

  returnFocusTo.value?.focus()
  returnFocusTo.value = null
}, { immediate: true })
</script>

<template>
  <div
    v-if="open"
    ref="rootEl"
    data-testid="avatar-remove"
    tabindex="-1"
    class="fixed inset-0 z-[60] outline-none"
    v-on="surfaceHandlers"
    @keydown.esc="close"
  >
    <div
      data-testid="avatar-remove-backdrop"
      class="absolute inset-0 bg-black/60"
      @click="close"
    />

    <section
      data-testid="avatar-remove-sheet"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-describedby="descriptionId"
      :style="panelStyle"
      class="absolute inset-x-0 bottom-0 mx-auto max-w-2xl rounded-t-3xl border-t border-default bg-default pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
    >
      <div
        data-testid="avatar-remove-drag-zone"
        class="touch-none select-none"
        v-on="handleHandlers"
      >
        <div class="grid place-items-center py-3">
          <span
            class="h-1 w-10 rounded-full bg-accented"
            aria-hidden="true"
          />
        </div>
      </div>

      <div class="px-6 pt-4 text-center">
        <div
          class="mx-auto grid size-16 place-items-center rounded-full border border-error/40 bg-error/10"
          aria-hidden="true"
        >
          <UIcon
            name="i-lucide-trash-2"
            class="size-7 text-error"
          />
        </div>

        <h2
          :id="titleId"
          data-testid="avatar-remove-title"
          class="mt-5 text-2xl font-bold"
        >
          移除頭像？
        </h2>

        <!--
          兩行分開寫，不是一段話裡的兩句：第一行說「會變成什麼」、第二行說「還救得回來」。
          擠成一段時，讀者容易只讀到前半就以為這一步不可逆。
        -->
        <div
          :id="descriptionId"
          class="mt-3 space-y-1 text-toned"
        >
          <p data-testid="avatar-remove-line">
            移除後將改為顯示名稱的第一個字。
          </p>
          <p data-testid="avatar-remove-line">
            你隨時可以再上傳新的頭像。
          </p>
        </div>

        <div class="mt-7 space-y-3">
          <UButton
            data-testid="avatar-remove-confirm"
            type="button"
            color="error"
            variant="outline"
            size="xl"
            block
            :loading="removing"
            class="rounded-2xl py-4 text-base font-bold"
            @click="confirm"
          >
            {{ removing ? '移除中…' : '移除頭像' }}
          </UButton>

          <UButton
            data-testid="avatar-remove-cancel"
            type="button"
            color="neutral"
            variant="outline"
            size="xl"
            block
            :disabled="removing"
            class="rounded-2xl py-4 text-base"
            @click="close"
          >
            取消
          </UButton>
        </div>
      </div>
    </section>
  </div>
</template>
