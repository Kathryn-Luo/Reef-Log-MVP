<script setup lang="ts">
import type { WaterSummaryDto } from '#shared/types/home'
import type { ReadingStatus } from '#shared/utils/waterQuality'
import { buildWaterDashboardRows } from '#shared/utils/waterQuality'
import { SPARKLINE_HEIGHT, SPARKLINE_WIDTH, sparklinePoints } from '#shared/utils/sparkline'
import { formatUpdatedAgo } from '#shared/utils/relativeTime'

const props = defineProps<{
  /** 展開狀態由首頁持有——關閉的手勢有三種，狀態放在這裡會有三個地方要同步 */
  open: boolean
  /** 副標的「<缸名> · 更新於 N 小時前」前半段 */
  tankName: string
  /** 該缸最新一筆水質記錄；尚無任何記錄時為 null，六列都會是「—」 */
  water: WaterSummaryDto | null
  /** 相對時間的基準點，由頁面統一提供 */
  now: Date
}>()

const emit = defineEmits<{ close: [] }>()

// 與 WaterSummaryCard 同一組配色：正常＝全站主色（截圖量到的 teal-400）、偏低藍、偏高橘
const STATUS_CLASSES: Record<ReadingStatus, string> = {
  normal: 'text-primary',
  low: 'text-blue-400',
  high: 'text-amber-400',
}

// aria-labelledby 要指到標題，同頁若出現第二個 sheet 也不會撞 id
const titleId = useId()

const rows = computed(() => buildWaterDashboardRows(props.water))

const updatedAgo = computed(() =>
  props.water ? formatUpdatedAgo(props.water.measuredAt, props.now) : null,
)

const subtitle = computed(() =>
  updatedAgo.value ? `${props.tankName} · ${updatedAgo.value}` : props.tankName,
)

function statusClass(status: ReadingStatus | null): string {
  return status ? STATUS_CLASSES[status] : 'text-dimmed'
}

// ── 向下拖曳把手關閉 ───────────────────────────────────────────
//
// 拖到這個距離放開才算「要關掉」。太短會讓輕輕一碰就關掉，
// 太長則要拖過半個畫面，兩者都很難用。
const DRAG_CLOSE_DISTANCE = 60

const dragStartY = ref<number | null>(null)
const dragOffset = ref(0)

// 拖曳中才寫 inline style：沒在拖的時候留著 transform 會蓋掉升起 / 收合的過場
const panelStyle = computed(() =>
  dragOffset.value > 0 ? { transform: `translateY(${dragOffset.value}px)` } : undefined,
)

function startDrag(event: PointerEvent) {
  dragStartY.value = event.clientY
  dragOffset.value = 0
}

function moveDrag(event: PointerEvent) {
  if (dragStartY.value === null) {
    return
  }

  // 只跟著往下走。往上拖沒有對應的動作，跟上去只會把面板拉出畫面上緣
  dragOffset.value = Math.max(0, event.clientY - dragStartY.value)
}

function endDrag(event: PointerEvent) {
  const startY = dragStartY.value

  dragStartY.value = null
  dragOffset.value = 0

  if (startY !== null && event.clientY - startY >= DRAG_CLOSE_DISTANCE) {
    emit('close')
  }
}

/** 拖曳中的指標被系統收走（來電、手勢接管）時當作沒拖過，不要留在半路 */
function cancelDrag() {
  dragStartY.value = null
  dragOffset.value = 0
}

// ── 焦點 ─────────────────────────────────────────────────────
//
// 展開時把焦點移進來，Esc 才收得到；收合時還給原本那個元素（水質摘要列），
// 不然關掉之後鍵盤焦點會掉回 body，得從頁面最上面重新 Tab 一輪。
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
  <!--
    Story 的三種關閉手勢：右上角 ✕、背景遮罩、向下拖曳把手。
    Esc 不在 Story 裡，但 role="dialog" + aria-modal 的鍵盤慣例就是它——
    沒有它的話，用鍵盤的人進得來卻出不去。

    整層蓋在 z-50 的底部 tab 列之上：儀表板攤開時 tab 列不該還浮在上面。
    pointermove / pointerup 收在這一層而不是把手上，手指拖出把手範圍也追得到。
  -->
  <div
    v-if="open"
    ref="rootEl"
    data-testid="water-dashboard"
    tabindex="-1"
    class="fixed inset-0 z-[60] outline-none"
    @pointermove="moveDrag"
    @pointerup="endDrag"
    @pointercancel="cancelDrag"
    @keydown.esc="emit('close')"
  >
    <!-- 背景首頁變暗但仍可見：半透明而不是實心 -->
    <div
      data-testid="water-dashboard-backdrop"
      class="absolute inset-0 bg-black/60"
      @click="emit('close')"
    />

    <section
      data-testid="water-dashboard-sheet"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :style="panelStyle"
      class="absolute inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] max-w-2xl flex-col rounded-t-3xl border-t border-default bg-default pb-[env(safe-area-inset-bottom)]"
    >
      <!--
        把手：touch-none 讓瀏覽器把垂直手勢交給我們，不然拖曳會被解讀成捲動。
        點擊區域比那條小灰線大得多——只有 4px 高的話根本抓不到。
      -->
      <div
        data-testid="water-dashboard-handle"
        class="grid touch-none place-items-center py-3"
        @pointerdown="startDrag"
      >
        <span
          class="h-1 w-10 rounded-full bg-accented"
          aria-hidden="true"
        />
      </div>

      <header class="flex items-start justify-between gap-4 px-6 pb-4">
        <div class="min-w-0">
          <h2
            :id="titleId"
            data-testid="water-dashboard-title"
            class="text-2xl font-bold"
          >
            數據儀表板
          </h2>
          <p
            data-testid="water-dashboard-subtitle"
            class="mt-1 truncate text-sm text-dimmed"
          >
            {{ subtitle }}
          </p>
        </div>

        <button
          data-testid="water-dashboard-close"
          type="button"
          aria-label="關閉"
          class="grid size-10 shrink-0 place-items-center rounded-full bg-elevated text-muted transition-colors hover:text-default"
          @click="emit('close')"
        >
          <UIcon
            name="i-lucide-x"
            class="size-5"
          />
        </button>
      </header>

      <!-- 六列固定到齊，列數多到超過畫面時只捲這一段，標題與底部按鈕留著 -->
      <ul class="min-h-0 flex-1 overflow-y-auto px-6">
        <li
          v-for="row in rows"
          :key="row.parameter"
          data-testid="water-dashboard-row"
          :data-parameter="row.parameter"
          class="flex items-center gap-4 border-b border-default/60 py-4 last:border-b-0"
        >
          <span
            data-testid="water-dashboard-label"
            class="w-12 shrink-0 font-mono text-sm text-muted"
          >
            {{ row.label }}
          </span>

          <p class="flex w-28 shrink-0 items-baseline gap-1">
            <span
              data-testid="water-dashboard-value"
              :data-status="row.status ?? undefined"
              class="font-mono text-2xl font-bold"
              :class="statusClass(row.status)"
            >{{ row.display }}</span>
            <span
              data-testid="water-dashboard-unit"
              class="text-xs text-dimmed"
            >{{ row.unit }}</span>
          </p>

          <!--
            迷你趨勢線。少於兩筆讀數畫不出走勢，這時 svg 不渲染，但外框留著——
            補一條假的水平線會讓人以為「量了好幾次都一樣」，
            而整塊拿掉則會讓那一列的右側區塊往左跑，六列對不齊。
          -->
          <div class="flex min-w-0 flex-1 justify-center">
            <svg
              v-if="sparklinePoints(row.trend)"
              data-testid="water-dashboard-trend"
              :viewBox="`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`"
              :width="SPARKLINE_WIDTH"
              :height="SPARKLINE_HEIGHT"
              class="shrink-0"
              :class="statusClass(row.status)"
              role="presentation"
              aria-hidden="true"
            >
              <polyline
                :points="sparklinePoints(row.trend)"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>

          <div class="shrink-0 text-right">
            <p
              v-if="row.statusLabel"
              data-testid="water-dashboard-status"
              class="text-sm font-semibold"
              :class="statusClass(row.status)"
            >
              {{ row.statusLabel }}{{ row.statusIcon ? ` ${row.statusIcon}` : '' }}
            </p>
            <p
              data-testid="water-dashboard-range"
              class="font-mono text-xs text-dimmed"
              :class="row.statusLabel ? 'mt-0.5' : ''"
            >
              {{ row.rangeText }}
            </p>
          </div>
        </li>
      </ul>

      <!--
        主要行動：關閉儀表板並前往記錄水質。
        用連結而不是按鈕＋navigateTo：右鍵開新分頁、長按預覽這些瀏覽器原生行為才留得住。
      -->
      <div class="px-6 pb-6 pt-4">
        <NuxtLink
          data-testid="water-dashboard-log"
          to="/log"
          class="flex items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-base font-bold text-inverted"
          @click="emit('close')"
        >
          <UIcon
            name="i-lucide-plus"
            class="size-5"
          />
          記錄水質
        </NuxtLink>
      </div>
    </section>
  </div>
</template>
