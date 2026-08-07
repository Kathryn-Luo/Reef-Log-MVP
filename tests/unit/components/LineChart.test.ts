import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import LineChart, {
  CHART_BAND_OPACITY,
  CHART_LINE_COLOR,
} from '../../../app/components/LineChart.vue'

// 折線圖包裝元件的 smoke test（issue #140 第 4 節第 4 點）。
//
// 這一支證明的不是「圖好不好看」，是**圖畫出來的東西斷言得到**——這正是 #140 選
// ECharts + SVG renderer 而不是 canvas 的全部理由。下面每一條都在 DOM 上直接找節點：
// 找得到，代表 #123 的驗收條件（色帶對應 7–9、X 軸的日期刻度、單點時不畫線）寫得出來；
// 找不到，代表這個技術選擇沒有兌現，該在這裡紅，而不是等到 #123 才發現。

const POINTS = [
  { measuredAt: '2026-06-08T09:00:00.000Z', value: 7.8 },
  { measuredAt: '2026-06-22T09:00:00.000Z', value: 8.4 },
]

/**
 * happy-dom 不做版面計算，容器量出來是 0×0，echarts 會判定「沒有尺寸」而整張圖不畫。
 * 所以測試明確給一組像素尺寸——瀏覽器上不給 width，寬度跟著容器走（響應式）。
 */
const WIDTH = 600
const HEIGHT = 300

function mountChart(props: Record<string, unknown> = {}): Promise<VueWrapper> {
  return mountSuspended(LineChart, {
    route: '/',
    props: { points: POINTS, width: WIDTH, height: HEIGHT, ...props },
  })
}

/** SVG 上所有的文字節點內容——X 軸與 Y 軸的刻度都在這裡面 */
const tickTexts = (chart: VueWrapper) => chart.findAll('text').map(node => node.text())

/** 「6/08」這種日期刻度 */
const DATE_TICK = /^\d{1,2}\/\d{2}$/

/** 數值刻度（Y 軸）。日期刻度含斜線，Number() 會是 NaN，不會被誤收 */
const isNumericTick = (text: string) => text !== '' && Number.isFinite(Number(text))

/**
 * 折線本身。
 *
 * 用「線色 + 不填色」認：色帶那一塊雖然也帶著同一個 stroke，但它是填色的封閉區塊
 * （fill 是顏色），格線則是另一個顏色。
 */
const seriesLines = (chart: VueWrapper) =>
  chart.findAll('path').filter(path =>
    path.attributes('stroke') === CHART_LINE_COLOR && path.attributes('fill') === 'none')

/** 正常區間色帶：echarts 把半透明填色拆成 fill 與 fill-opacity 兩個屬性 */
const bandShapes = (chart: VueWrapper) =>
  chart.findAll('path').filter(path =>
    path.attributes('fill-opacity') === String(CHART_BAND_OPACITY))

/** `d` 裡的 M / L 各是一個座標點 */
const coordinateCount = (d: string) => (d.match(/[ML]/g) ?? []).length

describe('LineChart — 兩個資料點', () => {
  // 以 SVG 渲染是這支 issue 的分水嶺：canvas 的話，下面每一條都只剩「有一個 canvas」。
  it('畫在 SVG 上，不是 canvas', async () => {
    const chart = await mountChart()

    expect(chart.find('svg').exists()).toBe(true)
    expect(chart.find('canvas').exists()).toBe(false)
  })

  // 兩個點連成一條線，而且線上的座標數就是餵進去的點數——多一個少一個都是錯的。
  it('兩個點連成一條折線', async () => {
    const chart = await mountChart()
    const lines = seriesLines(chart)

    expect(lines).toHaveLength(1)
    expect(coordinateCount(lines[0]!.attributes('d') ?? '')).toBe(POINTS.length)
  })

  // #123 的「圖表背景以色帶標示該元素的正常區間（如 KH 的 7–9）」要斷言的就是這個節點。
  it('給了正常區間就畫出色帶', async () => {
    const chart = await mountChart({ band: { min: 7, max: 9 } })

    expect(bandShapes(chart)).toHaveLength(1)
  })

  // 沒設定正常區間的元素不該憑空多一塊背景——色帶的有無要跟著資料走。
  it('沒給正常區間就不畫色帶', async () => {
    const chart = await mountChart({ band: null })

    expect(bandShapes(chart)).toHaveLength(0)
  })

  // 色帶落在 Y 軸範圍外的話，echarts 會把它裁成整片背景，看起來就像「整個區間都正常」。
  // 讀值 7.8–8.4 落在 7–9 裡面，所以軸的上下界要讓給色帶，而不是貼著讀值收斂。
  it('Y 軸範圍涵蓋色帶的上下界', async () => {
    const chart = await mountChart({ band: { min: 7, max: 9 } })
    const values = tickTexts(chart).filter(isNumericTick).map(Number)

    expect(values.length).toBeGreaterThan(0)
    expect(Math.min(...values)).toBeLessThanOrEqual(7)
    expect(Math.max(...values)).toBeGreaterThanOrEqual(9)
  })

  // #123 的「X 軸顯示區間內的日期刻度（如 6/08、6/22、7/04）」。
  // 刻度的挑選由 echarts 的時間軸負責，這裡守的是「真的是日期、而且格式是 M/DD」。
  it('X 軸是日期刻度，Y 軸是數值刻度', async () => {
    const chart = await mountChart()
    const texts = tickTexts(chart)

    expect(texts.filter(text => DATE_TICK.test(text)).length).toBeGreaterThanOrEqual(2)
    expect(texts.filter(isNumericTick).length).toBeGreaterThanOrEqual(2)
  })
})
