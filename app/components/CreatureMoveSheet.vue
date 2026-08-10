<script setup lang="ts">
import type { TankOption } from '#shared/types/home'
import type { MoveFailureView } from '#shared/utils/creatureMove'
import { formatTankSpec, tankDotColor } from '#shared/utils/creatureMove'

// 移動到其他缸（issue #120 的 3b / 3c / 3d）。
//
// 沿用水質儀表板的 bottom sheet 語彙：底部升起、半透明遮罩、頂端拖曳握把。
// 換缸是低頻、需看清目標的選擇任務，sheet 疊在詳情頁上還保留著「生物現在在哪」的上下文。
//
// 這一層只負責畫與收手勢：選了哪一缸、送不送得出去、失敗之後怎麼說，都由詳情頁持有
// （與 WaterDashboardSheet 同一個分工）。狀態放在這裡的話，「送出中」會有兩份。
const props = defineProps<{
  /** 展開狀態由詳情頁持有——關閉的手勢有四種，狀態放在這裡會有四個地方要同步 */
  open: boolean
  creatureName: string
  /** 生物**現在**所在的缸。畫面不做樂觀更新，成功重新取資料之前它不會變 */
  currentTankName: string
  /** 可選的目標缸：名下其他未封存的缸，已濾掉目前所在的那一個 */
  tanks: TankOption[]
  selectedTankId: string | null
  moving: boolean
  /** 失敗之後要說的那一句與唯一走得下去的動作，null＝還沒失敗過 */
  failure: MoveFailureView | null
}>()

const emit = defineEmits<{
  close: []
  select: [tankId: string]
  confirm: []
  /** 回到選擇狀態：把錯誤卡片收起來，重新選一個目標 */
  dismissError: []
}>()

const titleId = useId()

const selectedTank = computed(() =>
  props.tanks.find(tank => tank.id === props.selectedTankId) ?? null,
)

/**
 * 主鈕的文案帶著目的地（「移動到珊瑚缸」而不是抽象的「確定」）。
 *
 * 失敗之後換成那一次唯一走得下去的動作：400 / 404 是「這個目標不行」，只能換一個，
 * 所以是「選其他缸」而**不是**「重試」——再送一次同一個目標只會再收到一次同樣的錯誤。
 */
const primaryLabel = computed(() => {
  if (props.moving) {
    return '移動中…'
  }

  if (props.failure) {
    return props.failure.action === 'retry' ? '重試' : '選其他缸'
  }

  return `移動到${selectedTank.value?.name ?? ''}`
})

/**
 * 還沒選任何目標時，主鈕整顆不出現。
 *
 * 只是 disabled 的話，一顆按不下去、而且文案還缺著目的地的按鈕會讓人以為畫面壞了
 * （與詳情頁的「儲存」同一個判準，見 PR #58 review）。
 */
const showPrimary = computed(() => props.moving || props.failure !== null || selectedTank.value !== null)

/** 下方文字鈕：處理中不提供取消；重試那一態才把「選其他缸」放在這裡 */
const secondaryLabel = computed(() => {
  if (props.moving) {
    return '請稍候'
  }

  return props.failure?.action === 'retry' ? '選其他缸' : '取消'
})

function primaryAction() {
  if (props.moving) {
    return
  }

  if (props.failure?.action === 'choose-other') {
    emit('dismissError')
    return
  }

  emit('confirm')
}

function secondaryAction() {
  if (props.moving) {
    return
  }

  if (props.failure?.action === 'retry') {
    emit('dismissError')
    return
  }

  emit('close')
}

/** 送出中一律不關：請求已經在路上，收掉畫面只會讓人不知道它到底成了沒有 */
function close() {
  if (!props.moving) {
    emit('close')
  }
}

function select(tankId: string) {
  if (!props.moving) {
    emit('select', tankId)
  }
}

// 展開時把底下那份文件鎖住，不然手指在遮罩上滑動會捲到背景頁面
useScrollLock(computed(() => props.open))

// 向下拖曳關閉。缸清單是唯一捲得動的那一段（缸多的時候仍要捲得到最後一個）
const { panelStyle, surfaceHandlers, handleHandlers } = useSheetDrag({
  onClose: close,
  scrollArea: '[data-testid="creature-move-list"]',
})

// 展開時把焦點移進來，Esc 才收得到；收合時還給原本那個元素（「移動到其他缸」那一列），
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
    data-testid="creature-move"
    tabindex="-1"
    class="fixed inset-0 z-[60] outline-none"
    v-on="surfaceHandlers"
    @keydown.esc="close"
  >
    <!-- 背景詳情頁變暗但仍可見：換缸要保留「生物現在在哪」的上下文 -->
    <div
      data-testid="creature-move-backdrop"
      class="absolute inset-0 bg-black/60"
      @click="close"
    />

    <section
      data-testid="creature-move-sheet"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :style="panelStyle"
      class="absolute inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] max-w-2xl flex-col rounded-t-3xl border-t border-default bg-default pb-[env(safe-area-inset-bottom)]"
    >
      <!-- 可拖曳的一整塊：把手加上標題區塊（與水質儀表板同一個作法） -->
      <div
        data-testid="creature-move-drag-zone"
        class="shrink-0 touch-none select-none"
        v-on="handleHandlers"
      >
        <div class="grid place-items-center py-3">
          <span
            data-testid="creature-move-handle"
            class="h-1 w-10 rounded-full bg-accented"
            aria-hidden="true"
          />
        </div>

        <header class="px-6 pb-4">
          <h2
            :id="titleId"
            data-testid="creature-move-title"
            class="text-2xl font-bold"
          >
            移動到其他缸
          </h2>

          <!--
            失敗時措辭由「目前在」換成「仍在」：畫面不做樂觀更新，那一刻要回答的問題
            正是「那牠現在到底在哪一缸」。
          -->
          <p
            data-testid="creature-move-subtitle"
            class="mt-1 truncate text-sm text-dimmed"
          >
            {{ creatureName }} · {{ failure ? '仍在' : '目前在' }}
            <span class="font-semibold text-primary">{{ currentTankName }}</span>
          </p>
        </header>
      </div>

      <!--
        錯誤卡片。排在清單之上：先說發生了什麼、生物現在在哪，再讓人看清單選下一個。
      -->
      <div
        v-if="failure"
        data-testid="creature-move-error"
        role="alert"
        class="mx-6 mb-4 flex shrink-0 items-start gap-3 rounded-2xl border border-error bg-error/10 p-4"
      >
        <UIcon
          name="i-lucide-circle-alert"
          class="mt-0.5 size-5 shrink-0 text-error"
          aria-hidden="true"
        />

        <div class="min-w-0">
          <p class="font-semibold text-error">
            移動失敗
          </p>
          <p
            data-testid="creature-move-error-message"
            class="mt-1 text-sm text-toned"
          >
            {{ failure.message }}
          </p>
        </div>
      </div>

      <!-- 目標缸清單。目標通常 1–3 個，直接平鋪不需搜尋 -->
      <ul
        data-testid="creature-move-list"
        class="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-6"
      >
        <li
          v-for="tank in tanks"
          :key="tank.id"
        >
          <button
            data-testid="creature-move-option"
            type="button"
            :data-tank-id="tank.id"
            :aria-pressed="tank.id === selectedTankId ? 'true' : 'false'"
            :disabled="moving"
            class="flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors"
            :class="[
              tank.id === selectedTankId ? 'border-primary bg-primary/10' : 'border-default bg-elevated/40',
              // 送出中整份清單鎖住並灰化：選取不能再改
              moving ? 'opacity-50' : '',
            ]"
            @click="select(tank.id)"
          >
            <span
              class="size-5 shrink-0 rounded-[7px]"
              :style="{ backgroundColor: tankDotColor(tank) }"
              aria-hidden="true"
            />

            <span class="min-w-0 flex-1">
              <span class="block truncate text-lg font-semibold">{{ tank.name }}</span>
              <span class="mt-0.5 block truncate font-mono text-sm text-dimmed">{{ formatTankSpec(tank) }}</span>
            </span>

            <!-- 選中時是實心勾，未選是空心圈（3b） -->
            <span
              class="grid size-7 shrink-0 place-items-center rounded-full border"
              :class="tank.id === selectedTankId ? 'border-primary bg-primary text-inverted' : 'border-accented'"
              aria-hidden="true"
            >
              <UIcon
                v-if="tank.id === selectedTankId"
                name="i-lucide-check"
                class="size-4"
              />
            </span>
          </button>
        </li>
      </ul>

      <div class="shrink-0 px-6 pb-6 pt-4">
        <UButton
          v-if="showPrimary"
          data-testid="creature-move-confirm"
          type="button"
          color="primary"
          size="xl"
          block
          :loading="moving"
          class="rounded-2xl py-4 text-base font-bold"
          @click="primaryAction"
        >
          {{ primaryLabel }}
        </UButton>

        <button
          data-testid="creature-move-cancel"
          type="button"
          :disabled="moving"
          class="mt-3 w-full py-2 text-center text-sm text-dimmed transition-colors hover:text-muted disabled:hover:text-dimmed"
          @click="secondaryAction"
        >
          {{ secondaryLabel }}
        </button>
      </div>
    </section>
  </div>
</template>
