<script setup lang="ts">
import type { WaterSummaryDto } from '#shared/types/home'
import type { ReadingStatus } from '#shared/utils/waterQuality'
import { summarizeWaterReadings } from '#shared/utils/waterQuality'
import { formatRelativeTime } from '#shared/utils/relativeTime'

const props = withDefaults(defineProps<{
  /** 該缸最新一筆水質記錄；尚無任何記錄時為 null */
  water: WaterSummaryDto | null
  /** 相對時間的基準點，由頁面統一提供 */
  now: Date
  /**
   * 頁面捲動時收成單行 pill：六格數字讓位，只留「水質」「N 需注意」與相對時間。
   * 向下捲看生物時想瞄的是「有沒有異常」，個別數值捲回頂端再看。
   */
  collapsed?: boolean
}>(), { collapsed: false })

/**
 * 使用者要看完整的數據儀表板（screen-2）。
 * 卡片不知道儀表板長什麼樣，也不持有它的展開狀態——只送出意圖，
 * 由首頁決定要開哪一個。
 */
const emit = defineEmits<{ expand: [] }>()

// Story 說的「綠」就是 screen-1 量到的主色 teal-400（見 app/app.config.ts），
// 所以正常項直接用 text-primary，跟著全站主色走
const STATUS_CLASSES: Record<ReadingStatus, string> = {
  normal: 'text-primary',
  low: 'text-blue-400',
  high: 'text-amber-400',
}

const summary = computed(() =>
  props.water ? summarizeWaterReadings(props.water.readings, props.water.targets) : null,
)

const measuredAgo = computed(() =>
  props.water ? formatRelativeTime(props.water.measuredAt, props.now) : null,
)
</script>

<template>
  <!--
    有水質記錄時整列就是數據儀表板的入口（issue #10），所以整張卡片是一顆 <button>：
    鍵盤焦點、Enter / 空白鍵、按鈕語意全部交給瀏覽器，不必自己補 role 與 keydown。

    尚無記錄時維持 <section>：那時候卡片裡已經有自己的「記錄水質」連結，
    再包一層按鈕就成了巢狀的互動元素，而且沒有資料的儀表板也沒東西可攤開。
  -->
  <component
    :is="summary ? 'button' : 'section'"
    data-testid="water-summary-card"
    :type="summary ? 'button' : undefined"
    class="block w-full rounded-2xl border border-default bg-elevated/40 px-4 text-left transition-[padding] duration-200 ease-out motion-reduce:transition-none"
    :class="collapsed ? 'py-2.5' : 'py-4'"
    @click="summary && emit('expand')"
  >
    <!--
      收合時空狀態與標題列並排成一列——它本來就只有一行，不必再往下擺。

      有水質記錄時不切成 flex：六格數字讓位之後標題列本來就自成一列，
      這時若改用併排版面，正在讓位（0 高但仍在版面裡）的那一塊會佔掉一份 gap，
      收合後右側就多出一段莫名的空白。
    -->
    <div
      data-testid="water-summary-row"
      :class="collapsed && !summary ? 'flex items-center gap-3' : ''"
    >
      <div class="flex items-center gap-2">
        <h2
          data-testid="water-title"
          class="font-semibold"
        >
          水質
        </h2>

        <span
          v-if="summary && summary.attentionCount > 0"
          data-testid="water-attention"
          class="rounded-md bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-400"
        >
          {{ summary.attentionCount }} 需注意
        </span>

        <span
          v-if="measuredAgo"
          data-testid="water-measured-at"
          class="text-xs text-dimmed"
        >
          · {{ measuredAgo }}
        </span>

        <!-- 截圖右側的「詳細 ∨」：整列都可點，這裡只是把「點了會怎樣」講出來 -->
        <span
          v-if="summary"
          data-testid="water-detail-hint"
          class="ml-auto flex shrink-0 items-center gap-0.5 text-sm text-muted"
        >
          詳細
          <UIcon
            name="i-lucide-chevron-down"
            class="size-4"
          />
        </span>
      </div>

      <!--
        收合時六格數字整塊讓位：外層 grid 由 1fr 補間到 0fr，內層 min-h-0 + overflow-hidden 負責裁切。
        整塊移除（v-if）雖然也會變矮，但那是節點的增減，CSS 補不了間（issue #55）。

        節點留在 DOM 裡，所以讓位時要一併 aria-hidden——
        不然螢幕報讀會念到畫面上看不見的六格數字。
        overflow-hidden 只能加在讓位的這一小塊，不可以往上加到 sticky 容器（會裁掉切換缸的選單）。
      -->
      <div
        v-if="summary"
        data-testid="water-readings-slot"
        :data-collapsed="collapsed ? 'true' : 'false'"
        :aria-hidden="collapsed ? 'true' : undefined"
        class="grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none"
        :class="collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'"
      >
        <div class="min-h-0 overflow-hidden">
          <div class="mt-3 grid grid-cols-6 gap-1">
            <div
              v-for="item in summary.items"
              :key="item.parameter"
              data-testid="water-reading"
              class="text-center"
            >
              <p
                data-testid="water-reading-label"
                class="font-mono text-[11px] text-dimmed"
              >
                {{ item.label }}
              </p>
              <p
                data-testid="water-reading-value"
                :data-status="item.status"
                class="mt-0.5 font-mono text-lg font-semibold"
                :class="STATUS_CLASSES[item.status]"
              >
                {{ item.display }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!--
        Given 該缸尚無任何水質記錄 → 不顯示徽章與相對時間，改給一個記錄水質的入口。
        空狀態本來就只有一行，收合時不再往下擺，直接接在標題列右側。
      -->
      <div
        v-else
        data-testid="water-empty"
        class="flex items-center gap-3"
        :class="collapsed ? 'ml-auto' : 'mt-3 w-full justify-between'"
      >
        <p class="text-sm text-muted">
          還沒有水質記錄
        </p>

        <NuxtLink
          data-testid="water-empty-action"
          to="/log"
          class="shrink-0 text-sm font-semibold text-primary"
        >
          記錄水質
        </NuxtLink>
      </div>
    </div>
  </component>
</template>
