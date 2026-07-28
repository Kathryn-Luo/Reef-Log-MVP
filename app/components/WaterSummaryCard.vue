<script setup lang="ts">
import type { WaterSummaryDto } from '#shared/types/home'
import type { ReadingStatus } from '#shared/utils/waterQuality'
import { summarizeWaterReadings } from '#shared/utils/waterQuality'
import { formatRelativeTime } from '#shared/utils/relativeTime'

const props = defineProps<{
  /** 該缸最新一筆水質記錄；尚無任何記錄時為 null */
  water: WaterSummaryDto | null
  /** 相對時間的基準點，由頁面統一提供 */
  now: Date
}>()

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
  <section class="rounded-2xl border border-default bg-elevated/40 p-4">
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
    </div>

    <div
      v-if="summary"
      class="mt-3 grid grid-cols-6 gap-1"
    >
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

    <!-- Given 該缸尚無任何水質記錄 → 不顯示徽章與相對時間，改給一個記錄水質的入口 -->
    <div
      v-else
      data-testid="water-empty"
      class="mt-3 flex items-center justify-between gap-3"
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
  </section>
</template>
