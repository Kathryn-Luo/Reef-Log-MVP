<script lang="ts">
// 選項物件的型別。`import type` 編譯後不留任何東西，所以這一行不會把整包 echarts
// 拉進 bundle——真正決定「載入了哪些模組」的是 plugin 裡那幾個子路徑 import。
import type { EChartsOption } from 'echarts'

// 折線圖的包裝元件（issue #140 第 4 節第 3 點）。
//
// 全 App 只有這一支知道 echarts 的選項長什麼樣子。頁面（#123）餵的是「一串讀值」與
// 「正常區間」這種本專案自己的語彙，換套件、改配色、調時間軸格式都只動這裡一個檔案。
// 套件的註冊（載入了哪些模組、用哪個 renderer）在 app/plugins/echarts.client.ts。
//
// 顏色寫成匯出的常數而不是 Tailwind class：echarts 畫的是 SVG 屬性，吃不到 class。
// 匯出則是為了讓測試按同一個值去找節點，不必在測試裡抄一份色碼。

/** 折線與資料點的顏色。teal-400，與 app.config.ts 的 primary 同一個取樣 */
export const CHART_LINE_COLOR = '#2dd4bf'

/** 折線寬度（px）。測試靠「線色 + 不填色」認折線，這個值只影響外觀 */
export const CHART_LINE_WIDTH = 2

/** 正常區間色帶的顏色與不透明度。色帶是背景，壓不過線本身 */
export const CHART_BAND_COLOR = '#2dd4bf'
export const CHART_BAND_OPACITY = 0.12

/** 刻度文字與格線：深色底上的次要資訊，比照全站的 text-muted / border-default */
export const CHART_AXIS_LABEL_COLOR = '#94a3b8'
export const CHART_GRID_LINE_COLOR = '#334155'

/**
 * 一個資料點。
 *
 * 形狀刻意與 `#shared/types/trend` 的 `TrendPointDto` 相同，但不 import 它：
 * 這支元件畫的是「一串帶時間的數字」，不必認識水質。#123 可以直接把
 * `series.points` 餵進來，型別上也對得起來。
 */
export interface LineChartPoint {
  /** ISO 8601 */
  measuredAt: string
  value: number
}

/** 正常區間。畫成圖表背景的一條色帶 */
export interface LineChartBand {
  min: number
  max: number
}
</script>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  /** 由舊到新 */
  points: LineChartPoint[]
  /** 沒有正常區間的資料就不畫色帶 */
  band?: LineChartBand | null
  /**
   * 固定寬度（px）。不給的話寬度跟著容器走，並開啟 autoresize——這是瀏覽器上的常態。
   *
   * 給的時機只有一個：happy-dom 之類不做版面計算的環境量不到容器（0×0），
   * echarts 會判定沒有尺寸而整張圖不畫。unit 測試因此要明確給一組。
   */
  width?: number | null
  /** 高度（px）。圖的高度不隨容器變，由呼叫端決定 */
  height?: number
}>(), {
  band: null,
  width: null,
  height: 240,
})

/**
 * 時間軸的刻度文字：`6/08`（issue #123 的截圖格式）。
 *
 * 用本地時間而不是 UTC：echarts 的時間軸本來就是照本地時區挑刻度的，這裡再用 UTC
 * 取月日的話，UTC+8 的使用者會看到刻度落在前一天。
 */
function formatDateTick(value: number): string {
  const date = new Date(value)

  return `${date.getMonth() + 1}/${String(date.getDate()).padStart(2, '0')}`
}

/**
 * Y 軸上下界。
 *
 * 有色帶時把色帶的上下界一起算進去：只照讀值收斂的話，讀值全部落在正常區間內時
 * （常態）色帶會被裁成整片背景，看起來像「整張圖都是正常區間」，等於沒畫。
 *
 * 沒有色帶時交給 `scale`——從 0 起跳會把水質那種「在小範圍內上下」的變化壓成一條平線。
 */
const yAxisRange = computed(() => {
  const values = props.points.map(point => point.value)

  if (!props.band) {
    return { scale: true }
  }

  return {
    min: Math.min(props.band.min, ...values),
    max: Math.max(props.band.max, ...values),
  }
})

const option = computed<EChartsOption>(() => ({
  // 關掉入場動畫：圖是拿來讀數字的，不是拿來看的；而且動畫期間的 DOM 還沒到位，
  // 測試會量到畫到一半的節點。
  animation: false,

  // 左邊留給 Y 軸刻度、下面留給日期刻度
  grid: { left: 44, right: 16, top: 16, bottom: 28 },

  xAxis: {
    type: 'time',
    axisTick: { show: false },
    axisLine: { lineStyle: { color: CHART_GRID_LINE_COLOR } },
    axisLabel: {
      color: CHART_AXIS_LABEL_COLOR,
      // 刻度擠在一起時自動少畫幾個，不要疊成一團看不懂
      hideOverlap: true,
      formatter: formatDateTick,
    },
  },

  yAxis: {
    type: 'value',
    ...yAxisRange.value,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: CHART_AXIS_LABEL_COLOR },
    splitLine: { lineStyle: { color: CHART_GRID_LINE_COLOR } },
  },

  series: [{
    type: 'line',
    // 每一筆讀值都要看得到自己那一個點：量測本來就稀疏，只有線的話看不出量了幾次
    showSymbol: true,
    symbolSize: 6,
    lineStyle: { color: CHART_LINE_COLOR, width: CHART_LINE_WIDTH },
    itemStyle: { color: CHART_LINE_COLOR },
    // 時間軸吃的是時間戳，不是字串
    data: props.points.map(point => [new Date(point.measuredAt).getTime(), point.value]),
    markArea: props.band
      ? {
          // 背景不該吃到滑鼠事件
          silent: true,
          itemStyle: { color: CHART_BAND_COLOR, opacity: CHART_BAND_OPACITY },
          data: [[{ yAxis: props.band.min }, { yAxis: props.band.max }]],
        }
      : undefined,
  }],
}))

const initOptions = computed(() => ({
  // renderer 在 plugin 裡只註冊了 SVG 一種，這裡再講一次是因為 echarts 的預設值是
  // 'canvas'——不指名的話它會去找一個沒有被註冊的 renderer。
  renderer: 'svg' as const,
  height: props.height,
  ...(props.width === null ? {} : { width: props.width }),
}))

/**
 * 自訂元素預設是 inline，寬高吃不進去，所以明講 display: block。
 * 寬度不指定時交給容器，配合 autoresize 就是響應式的那條路。
 */
const rootStyle = computed(() => ({
  display: 'block',
  width: props.width === null ? '100%' : `${props.width}px`,
  height: `${props.height}px`,
}))
</script>

<template>
  <VChart
    data-testid="line-chart"
    :style="rootStyle"
    :option="option"
    :init-options="initOptions"
    :autoresize="width === null"
  />
</template>
