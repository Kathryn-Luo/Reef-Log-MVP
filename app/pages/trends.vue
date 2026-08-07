<script setup lang="ts">
import type { TankOption, WaterParameterKey } from '#shared/types/home'
import type { TrendPageData, TrendRangeKey } from '#shared/types/trend'
import { DEFAULT_TREND_RANGE, TREND_RANGES } from '#shared/utils/trend'
import {
  MISSING_READING_TEXT,
  WATER_PARAMETER_FULL_LABELS,
  WATER_PARAMETER_ORDER,
  WATER_PARAMETER_UNITS,
  formatReadingDelta,
  formatReadingValue,
} from '#shared/utils/waterQuality'

// 趨勢圖（Epic #1 screen-4，issue #123 ＝ #12 的畫面那一半）。
//
// 資料那一半是 #126 / PR #135：GET /api/tanks/:id/trends 一次回六個測項的序列、統計與
// 正常區間。圖本身交給 app/components/LineChart.vue（#140 / PR #141）——這一頁只餵
// 「一串帶時間的讀值」與「色帶上下限」，不碰圖表套件自己的選項物件（換套件時要改的
// 因此只有那一個檔案；#140 留了一條會紅的斷言守著它，這裡連 import 都不該出現）。
//
// 這一頁刻意什麼都不算：平均 / 最高 / 最低 / 變化量全部照 API 給的顯示。前端重算一次
// 就是第二份真相，遲早跟後端不一樣（issue #123 第 3 節）。

useSeoMeta({
  title: '趨勢 · ReefLog',
})

/**
 * 圖的高度（px）。寬度跟著容器走（LineChart 不給 width 就是響應式），
 * 高度固定才不會在窄螢幕上變成一條扁線（issue #123 第 4-5 節）。
 */
const CHART_HEIGHT = 300

/** 四顆範圍按鈕的文案。清單本身用 TREND_RANGES，不在這裡另寫一份順序 */
const RANGE_LABELS: Record<TrendRangeKey, string> = {
  '7d': '7 天',
  '30d': '30 天',
  '90d': '90 天',
  'all': '全部',
}

/**
 * 變化量的三種樣子。
 *
 * 藍 ▼ / 橘 ▲ 是**方向**不是好壞：NO₃ 上升是壞事、KH 上升不是，畫成紅綠會講錯話
 * （issue #123 第 4-4 節）。
 *
 * 「持平」不畫箭頭，也不寫成「▲ 0」——後者看起來像上升了 0，而這裡的事實是
 * 「量了兩次，讀值一樣」。至於「只量了一次」，API 給的 change 是 null，整塊不顯示。
 */
const CHANGE_STYLES = {
  down: { icon: '▼', directionText: '下降', class: 'text-blue-400' },
  up: { icon: '▲', directionText: '上升', class: 'text-orange-400' },
  flat: { icon: '', directionText: '', class: 'text-muted' },
} as const

// 驗收條件指名 KH 預設選中（截圖上點亮的也是它），所以寫死而不是取排序第一個
const parameter = ref<WaterParameterKey>('KH')
const range = ref<TrendRangeKey>(DEFAULT_TREND_RANGE)

// $api 而不是裸 $fetch：session 過期時要被帶去登入頁，而不是停在一頁空資料上（#67）
const { $api } = useNuxtApp()

/**
 * 缸與趨勢串成同一個請求鏈，而不是兩個各自的 useAsyncData。
 *
 * 理由是驗收條件那條「不得先閃一次『這個區間沒有資料』」：拆成兩個的話，缸拿到之後、
 * 趨勢還沒發出去之前會有一拍「已完成但沒有資料」，畫面就會閃一次空狀態。
 * 併成一個之後，status 只有 pending → success 兩種樣子（issue #123 第 3 節）。
 *
 * watch 只有 range：切元素 tab 是純前端的事，六個測項本來就在同一份回應裡。
 * 換範圍時 useAsyncData 保留上一份 data，舊圖因此留在畫面上直到新資料到（4-3）。
 *
 * lazy：這一頁自己畫得出載入樣態，所以不在 setup 階段擋著整頁不渲染。
 */
const { data, status, refresh: reload } = useAsyncData('trends', async () => {
  const { tanks } = await $api<{ tanks: TankOption[] }>('/api/tanks')

  // 未指定時看的是清單第一個，也就是 schema 定義的「預設缸」（與 /log、/maintenance 一致）
  const tank = tanks[0] ?? null

  return {
    tank,
    page: tank
      ? await $api<TrendPageData>(`/api/tanks/${tank.id}/trends`, { query: { range: range.value } })
      : null,
  }
}, { lazy: true, watch: [range] })

/**
 * issue #132 / #133：請求失敗時 data 是 null，與「成功但這個區間沒有讀值」長得一模一樣。
 * 少了這一態，「拿不到資料」會被畫成「你沒有量過」——這一頁尤其糟，因為使用者會以為
 * 自己記過的水質不見了。
 *
 * 401 不在此列：那條路由由 $api 的攔截器帶去登入頁（#67），比這裡更早。
 */
const { failed: loadFailed, retrying, retry: retryLoad } = useLoadFailure([status], reload)

// 骨架只給「第一次、還沒有任何資料」的那一段。換範圍時 data 還在，走的是下面的
// refreshing——整張圖消失再長回來比等一下更難看懂（issue #123 第 4-3 節）。
const loading = computed(() =>
  !loadFailed.value && !data.value && (status.value === 'idle' || status.value === 'pending'),
)

/** 換範圍那一段：舊圖留著，另外講一句「更新中」 */
const refreshing = computed(() =>
  !loadFailed.value && !!data.value && status.value === 'pending',
)

const tank = computed(() => data.value?.tank ?? null)

const subtitle = computed(() =>
  tank.value ? [tank.value.name, tank.value.sizeSpec].filter(Boolean).join(' · ') : '',
)

const tabs = WATER_PARAMETER_ORDER.map(key => ({ key, label: WATER_PARAMETER_FULL_LABELS[key] }))
const ranges = TREND_RANGES.map(key => ({ key, label: RANGE_LABELS[key] }))

const label = computed(() => WATER_PARAMETER_FULL_LABELS[parameter.value])
const unit = computed(() => WATER_PARAMETER_UNITS[parameter.value])

// 六項一定都在（沒有讀值的那一項是空序列，不是缺席），所以找不到只可能是還沒載入
const series = computed(() =>
  data.value?.page?.series.find(candidate => candidate.parameter === parameter.value) ?? null,
)

const points = computed(() => series.value?.points ?? [])

/** 正常區間的色帶。server 端已經 fallback 完，前端不必再 resolveWaterTarget() */
const band = computed(() => {
  const target = series.value?.target

  return target ? { min: target.minValue, max: target.maxValue } : null
})

/** 沒有讀值時顯示「—」而不是 0：PO₄ 真的可能量到 0，兩者不能長一樣 */
function display(value: number | null | undefined): string {
  return value === null || value === undefined
    ? MISSING_READING_TEXT
    : formatReadingValue(parameter.value, value)
}

const latestText = computed(() => display(series.value?.latest))

const stats = computed(() => [
  { key: 'average', label: '平均', text: display(series.value?.average) },
  { key: 'highest', label: '最高', text: display(series.value?.highest) },
  { key: 'lowest', label: '最低', text: display(series.value?.lowest) },
])

/** null 代表「這一塊整個不顯示」：沒有讀值，或只有一筆（一筆算不出變化） */
const change = computed(() => {
  const value = series.value?.change

  if (!value) {
    return null
  }

  const direction = value.delta < 0 ? 'down' : value.delta > 0 ? 'up' : 'flat'

  return {
    direction,
    ...CHANGE_STYLES[direction],
    // 顯示的是變化的「大小」，方向由箭頭與顏色講。
    // 用 formatReadingDelta 而不是 formatReadingValue：截圖上的變化量是「0.4」，
    // 讀值那條省略前導 0 的規則（「.4」）在這裡看起來像漏字。
    text: direction === 'flat'
      ? `持平（${value.days} 天）`
      : `${formatReadingDelta(parameter.value, Math.abs(value.delta))}（${value.days} 天）`,
  }
})
</script>

<template>
  <section class="mx-auto max-w-2xl pb-10">
    <!-- 頁首：趨勢 · <缸名> · <尺寸>。三態下都留著，人才知道自己在哪一頁 -->
    <header class="px-4 pt-[calc(1.5rem+env(safe-area-inset-top))]">
      <h1 class="truncate text-3xl font-bold">
        趨勢
      </h1>

      <p
        data-testid="trends-subtitle"
        class="mt-1 truncate text-sm text-muted"
      >
        {{ subtitle }}
      </p>
    </header>

    <!--
      拿不到資料。要排在骨架與空狀態之前：三者的序列都是空的，先問的那一個說了算。
      標題用 p——頁首的「趨勢」是常駐的 h1，錯誤區塊再給一個就變成同一頁兩個 h1。
    -->
    <LoadErrorState
      v-if="loadFailed"
      :retrying="retrying"
      title-tag="p"
      @retry="retryLoad"
    />

    <!--
      資料還在路上時的骨架。#84 之後是 SPA，首屏沒有伺服器算好的畫面，
      直接判斷「這個測項有沒有點」會先閃一次「這個區間還沒有記錄」。
    -->
    <div
      v-else-if="loading"
      data-testid="trends-loading"
      class="mt-6 space-y-4 px-4"
    >
      <div class="h-10 animate-pulse rounded-2xl bg-elevated/60" />
      <div class="h-14 w-40 animate-pulse rounded-2xl bg-elevated/60" />
      <div
        class="animate-pulse rounded-2xl bg-elevated/60"
        :style="{ height: `${CHART_HEIGHT}px` }"
      />
      <div class="h-10 animate-pulse rounded-2xl bg-elevated/60" />
      <span class="sr-only">載入中</span>
    </div>

    <!-- 趨勢是某一個缸的趨勢，沒有缸就沒有東西可畫 -->
    <div
      v-else-if="!tank"
      data-testid="tank-empty"
      class="px-4 py-12 text-center"
    >
      <p class="text-2xl font-semibold">
        還沒有任何缸
      </p>

      <p class="mx-auto mt-3 max-w-xs text-balance text-muted">
        趨勢是某一個缸的走勢，先建立一個缸、記幾筆水質，這裡就畫得出來。
      </p>

      <UButton
        data-testid="tank-empty-action"
        to="/tanks/new"
        icon="i-lucide-plus"
        color="primary"
        size="xl"
        block
        class="mt-8 rounded-2xl py-4 text-base font-semibold"
      >
        建立我的第一個缸
      </UButton>
    </div>

    <template v-else>
      <!--
        六個元素 tab 橫向一排。標籤都很短，390px 下排得下，所以不做橫向捲動
        （issue #123 第 4-2 節）。
      -->
      <div
        role="group"
        aria-label="選擇元素"
        class="mt-5 grid grid-cols-6 gap-1.5 px-4"
      >
        <button
          v-for="item in tabs"
          :key="item.key"
          data-testid="parameter-tab"
          type="button"
          :data-parameter="item.key"
          :aria-pressed="parameter === item.key ? 'true' : 'false'"
          class="rounded-xl border px-1 py-2.5 text-sm transition-colors"
          :class="parameter === item.key
            ? 'border-primary bg-primary font-semibold text-inverted'
            : 'border-default text-muted'"
          @click="parameter = item.key"
        >
          {{ item.label }}
        </button>
      </div>

      <!-- 上方大字：該區間最新一筆的值與單位；右側是期間變化量與方向 -->
      <div class="mt-6 flex items-end justify-between gap-3 px-4">
        <p class="flex items-baseline gap-2">
          <span
            data-testid="trend-latest"
            class="text-5xl font-bold tabular-nums"
          >{{ latestText }}</span>

          <span
            data-testid="trend-unit"
            class="text-sm text-muted"
          >{{ unit }}</span>
        </p>

        <!--
          沒有讀值、或只有一筆時整塊不顯示：一筆算不出「變化」，
          擺一個「▲ 0」會讓人以為量了兩次沒變（issue #123 第 4-3 節）。
        -->
        <p
          v-if="change"
          data-testid="trend-change"
          :data-direction="change.direction"
          class="flex items-baseline gap-1 text-lg font-semibold tabular-nums"
          :class="change.class"
        >
          <!-- 箭頭是圖形，報讀器唸「黑色下三角形」沒有意義，方向另外給一個字 -->
          <span
            v-if="change.icon"
            aria-hidden="true"
          >{{ change.icon }}</span>

          <span
            v-if="change.directionText"
            class="sr-only"
          >{{ change.directionText }}</span>

          <span data-testid="trend-change-value">{{ change.text }}</span>
        </p>
      </div>

      <div class="mt-4 px-4">
        <div
          class="relative rounded-2xl border border-default bg-elevated/30 p-3"
          :aria-busy="refreshing ? 'true' : 'false'"
        >
          <!--
            圖只餵資料：點、色帶上下限、高度。X 軸是真的時間軸、Y 軸取讀值與色帶的聯集，
            都由 LineChart 負責（issue #123 第 4-1 節）。
          -->
          <LineChart
            v-if="points.length"
            :points="points"
            :band="band"
            :height="CHART_HEIGHT"
            class="transition-opacity"
            :class="refreshing ? 'opacity-50' : ''"
          />

          <!-- 空：圖表區給一句文案，而不是一張空的座標系 -->
          <p
            v-else
            data-testid="trend-chart-empty"
            class="grid place-items-center px-6 text-center text-balance text-muted"
            :style="{ height: `${CHART_HEIGHT}px` }"
          >
            這個區間還沒有 {{ label }} 的記錄。
          </p>

          <!--
            換範圍那一段：舊圖留著，這裡講一句「更新中」。
            退回骨架的話，整張圖會消失再長回來（issue #123 第 4-3 節）。
          -->
          <p
            v-if="refreshing"
            data-testid="trends-refreshing"
            role="status"
            class="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted"
          >
            更新中…
          </p>
        </div>
      </div>

      <!--
        範圍四顆放在圖表下方（截圖如此），樣式與上方的元素 tab 明顯不同——
        兩排長得一樣的話會看不出哪一排管什麼（issue #123 第 4-2 節）。
      -->
      <div
        role="group"
        aria-label="選擇時間範圍"
        class="mt-4 grid grid-cols-4 gap-2 px-4"
      >
        <button
          v-for="item in ranges"
          :key="item.key"
          data-testid="range-button"
          type="button"
          :data-range="item.key"
          :aria-pressed="range === item.key ? 'true' : 'false'"
          class="rounded-2xl border py-3 text-sm transition-colors"
          :class="range === item.key
            ? 'border-primary bg-primary font-semibold text-inverted'
            : 'border-default bg-elevated/40 text-muted'"
          @click="range = item.key"
        >
          {{ item.label }}
        </button>
      </div>

      <!-- 平均 / 最高 / 最低。三個數字全部取自 API，這一頁不重算（issue #123 第 3 節） -->
      <div class="mt-4 grid grid-cols-3 gap-2 px-4">
        <div
          v-for="stat in stats"
          :key="stat.key"
          data-testid="trend-stat"
          :data-stat="stat.key"
          class="rounded-2xl border border-default bg-elevated/40 px-4 py-3"
        >
          <p
            data-testid="trend-stat-label"
            class="text-xs text-dimmed"
          >
            {{ stat.label }}
          </p>

          <p
            data-testid="trend-stat-value"
            class="mt-1 text-2xl font-bold tabular-nums"
          >
            {{ stat.text }}
          </p>
        </div>
      </div>
    </template>
  </section>
</template>
