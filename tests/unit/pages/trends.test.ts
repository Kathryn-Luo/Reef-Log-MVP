import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import TrendsPage from '../../../app/pages/trends.vue'
import LineChart, { CHART_BAND_OPACITY, CHART_LINE_COLOR } from '../../../app/components/LineChart.vue'
import { signedInUserSession } from '../support/session'
import type { TankOption, WaterParameterKey } from '#shared/types/home'
import type { TrendPageData, TrendRangeKey, TrendSeriesDto } from '#shared/types/trend'
import { summarizeTrendSeries } from '#shared/utils/trend'
import { DEFAULT_WATER_TARGETS, WATER_PARAMETER_ORDER } from '#shared/utils/waterQuality'

// 趨勢圖（screen-4，issue #123 ＝ #12 的畫面那一半）。
//
// 資料那一半（GET /api/tanks/:id/trends）已由 PR #135 合併進 main，圖表套件由 PR #141
// 帶進來（ECharts + SVG renderer，包裝在 app/components/LineChart.vue）。這裡把那份契約
// 當成夾具的形狀，驗畫面有沒有照著串——包含圖本身：SVG 渲染的節點斷言得到，
// 那正是 #140 選 SVG 而不是 canvas 的理由。
//
// 這一頁要登入才進得去（#67 的全域路由保護）。少了這張 session，
// mountSuspended 的導覽會先被導去 /login。
mockNuxtImport('useUserSession', () => () => signedInUserSession())

/**
 * happy-dom 不做版面計算，容器量出來是 0×0，echarts 會判定「沒有尺寸」而整張圖不畫。
 *
 * 頁面上的圖是響應式的（寬度跟著容器走，不寫死像素），所以不能像
 * tests/unit/components/LineChart.test.ts 那樣改用 `width` prop 繞過——那會讓測試
 * 驗的是一個瀏覽器上不存在的設定。這裡改成補上容器的尺寸，頁面本身保持原樣。
 */
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 })
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 300 })

const MAIN_TANK: TankOption = {
  id: 'tank-1',
  name: '主缸',
  sizeSpec: '4 尺',
  volumeLiters: 420,
  setupType: 'SPS MIXED',
  colorHex: '#2dd4bf',
}

const DAY = 24 * 60 * 60 * 1000

/** [幾天前, 讀值]。由現在往回推，測試才不會隨著時間漂移 */
type PointSpec = [daysAgo: number, value: number]

/**
 * 一個測項的序列。統計一律由 `summarizeTrendSeries()` 算——那正是 server 用的同一支，
 * 夾具因此不會在手算的平均值上跟真正的 API 分岔。
 * `target` 由 server 端 fallback 完（見 shared/types/trend.ts），這裡照樣給滿。
 */
function seriesOf(parameter: WaterParameterKey, specs: PointSpec[]): TrendSeriesDto {
  const points = specs.map(([daysAgo, value]) => ({
    measuredAt: new Date(Date.now() - daysAgo * DAY).toISOString(),
    value,
  }))

  return {
    parameter,
    points,
    ...summarizeTrendSeries(points),
    target: { parameter, ...DEFAULT_WATER_TARGETS[parameter] },
  }
}

/** 六個測項一定都在（沒有讀值的那一項是空序列，不是缺席） */
function trendPage(range: TrendRangeKey, specs: Partial<Record<WaterParameterKey, PointSpec[]>>): TrendPageData {
  return {
    range,
    series: WATER_PARAMETER_ORDER.map(parameter => seriesOf(parameter, specs[parameter] ?? [])),
  }
}

/**
 * 30 天的預設夾具。
 *
 * KH 是截圖那一組：最新 7.8 dKH、比七天前的 8.2 低了 0.4（畫面是「▼ 0.4（7 天）」）。
 * Ca 刻意是上升的，切 tab 之後方向、單位與統計要跟著換。
 */
const DEFAULT_SPECS: Record<WaterParameterKey, PointSpec[]> = {
  KH: [[21, 8.1], [14, 7.9], [7, 8.2], [0, 7.8]],
  CA: [[14, 400], [7, 410], [0, 420]],
  MG: [[14, 1240], [0, 1260]],
  NO3: [[14, 8], [0, 12]],
  PO4: [[14, 0.03], [0, 0.04]],
  SALINITY: [[14, 1.025], [0, 1.026]],
}

/** 90 天的夾具，KH 的每一個數字都與 30 天那份不同——換範圍之後畫面該全部跟著換 */
const NINETY_DAY_SPECS: Record<WaterParameterKey, PointSpec[]> = {
  ...DEFAULT_SPECS,
  KH: [[80, 9], [40, 8.6], [0, 9.1]],
}

/** 把某支 API 的回應停在半路，用來驗「資料還在路上」的樣態 */
function gate() {
  let open!: () => void
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })

  return { promise, open }
}

const state = {
  tanks: [] as TankOption[],
  /** 各區間各自的回應。沒有列出來的區間退回 30 天那一份 */
  pages: {} as Partial<Record<TrendRangeKey, TrendPageData>>,
  hold: { trends: null as ReturnType<typeof gate> | null },
  fail: { tanks: false, trends: false },
  /** 每一次 GET /trends 帶的 range，依序記下來——切 tab 不該讓這個陣列變長 */
  ranges: [] as (string | null)[],
}

/** 說不出原因的失敗（500 / 離線 / function 掛掉），沒有可以直接顯示給使用者的訊息 */
function serverError() {
  return createError({ statusCode: 500, statusMessage: 'Internal Server Error' })
}

registerEndpoint('/api/tanks', () => {
  if (state.fail.tanks) {
    throw serverError()
  }

  return { tanks: state.tanks }
})

registerEndpoint('/api/tanks/tank-1/trends', async (event) => {
  const range = new URL(event.path, 'http://localhost').searchParams.get('range')

  state.ranges.push(range)

  await state.hold.trends?.promise

  if (state.fail.trends) {
    throw serverError()
  }

  return state.pages[range as TrendRangeKey] ?? state.pages['30d']
})

enableAutoUnmount(afterEach)

beforeEach(() => {
  // useAsyncData 的結果會留在 payload 上，測試之間必須清掉才不會拿到上一題的資料
  clearNuxtData()

  state.tanks = [MAIN_TANK]
  state.pages = { '30d': trendPage('30d', DEFAULT_SPECS) }
  state.hold = { trends: null }
  state.fail = { tanks: false, trends: false }
  state.ranges = []
})

type Page = Awaited<ReturnType<typeof mountSuspended>>

/**
 * 這一頁的載入是兩段串起來的（先問有哪些缸，再問那個缸的趨勢），
 * 所以要 flush 兩輪才輪得到第二段的回應。
 */
async function settle() {
  await flushPromises()
  await flushPromises()
}

async function open() {
  const page = await mountSuspended(TrendsPage, { route: '/trends' })

  await settle()

  return page
}

const tab = (page: Page, parameter: WaterParameterKey) =>
  page.get(`[data-testid="parameter-tab"][data-parameter="${parameter}"]`)

const rangeButton = (page: Page, range: TrendRangeKey) =>
  page.get(`[data-testid="range-button"][data-range="${range}"]`)

async function selectParameter(page: Page, parameter: WaterParameterKey) {
  await tab(page, parameter).trigger('click')
  await settle()
}

async function selectRange(page: Page, range: TrendRangeKey) {
  await rangeButton(page, range).trigger('click')

  // 換範圍比首次載入多一拍：watch 先觸發 refresh，之後才輪得到那兩支串起來的請求
  await flushPromises()
  await settle()
}

/** 三格統計的顯示值，依序是平均 / 最高 / 最低 */
const statTexts = (page: Page) =>
  page.findAll('[data-testid="trend-stat-value"]').map(stat => stat.text())

/** 變化量那一塊的文字。圖示與螢幕報讀用的字各自在自己的節點裡，所以壓成一行再比 */
const changeText = (page: Page) =>
  page.get('[data-testid="trend-change"]').text().replace(/\s+/g, ' ')

/**
 * 折線本身：線色 + 不填色（與 tests/unit/components/LineChart.test.ts 同一個認法）。
 * 色帶雖然也帶著同一個 stroke，但它是填色的封閉區塊。
 */
const seriesLines = (page: Page) =>
  page.findAll('path').filter(path =>
    path.attributes('stroke') === CHART_LINE_COLOR && path.attributes('fill') === 'none')

/** 正常區間色帶：echarts 把半透明填色拆成 fill 與 fill-opacity 兩個屬性 */
const bandShapes = (page: Page) =>
  page.findAll('path').filter(path => path.attributes('fill-opacity') === String(CHART_BAND_OPACITY))

/** `d` 裡的 M / L 各是一個座標點 */
const coordinateCount = (d: string) => (d.match(/[ML]/g) ?? []).length

/** SVG 上的文字節點——X 軸與 Y 軸的刻度都在這裡面 */
const tickTexts = (page: Page) => page.findAll('svg text').map(node => node.text())

/** 「6/08」這種日期刻度 */
const DATE_TICK = /^\d{1,2}\/\d{2}$/

/** 數值刻度（Y 軸）。日期刻度含斜線，Number() 會是 NaN，不會被誤收 */
const isNumericTick = (text: string) => text !== '' && Number.isFinite(Number(text))

describe('趨勢 — 頁首與預設狀態', () => {
  // Given 我進入「趨勢」頁 / When 畫面載入
  // Then 頁首顯示「趨勢」與副標「<缸名> · <尺寸>」
  it('顯示標題與「<缸名> · <尺寸>」副標', async () => {
    const page = await open()

    expect(page.get('h1').text()).toBe('趨勢')
    expect(page.get('[data-testid="trends-subtitle"]').text()).toBe('主缸 · 4 尺')
  })

  it('沒有填尺寸的缸，副標只有缸名', async () => {
    state.tanks = [{ ...MAIN_TANK, sizeSpec: null }]

    const page = await open()

    expect(page.get('[data-testid="trends-subtitle"]').text()).toBe('主缸')
  })

  // And 六個元素 tab（KH / Ca / Mg / NO₃ / PO₄ / 鹽度）中「KH」預設選中
  it('六個元素 tab 依序排列，KH 預設選中', async () => {
    const page = await open()
    const tabs = page.findAll('[data-testid="parameter-tab"]')

    expect(tabs.map(node => node.attributes('data-parameter')))
      .toEqual(['KH', 'CA', 'MG', 'NO3', 'PO4', 'SALINITY'])
    expect(tabs.map(node => node.text())).toEqual(['KH', 'Ca', 'Mg', 'NO₃', 'PO₄', '鹽度'])
    expect(tabs.map(node => node.attributes('aria-pressed')))
      .toEqual(['true', 'false', 'false', 'false', 'false', 'false'])
  })

  // And 時間範圍預設選中「30 天」
  it('四顆範圍按鈕依序排列，30 天預設選中', async () => {
    const page = await open()
    const buttons = page.findAll('[data-testid="range-button"]')

    expect(buttons.map(node => node.attributes('data-range'))).toEqual(['7d', '30d', '90d', 'all'])
    expect(buttons.map(node => node.text())).toEqual(['7 天', '30 天', '90 天', '全部'])
    expect(buttons.map(node => node.attributes('aria-pressed'))).toEqual(['false', 'true', 'false', 'false'])
  })

  // 預設選中的那顆要真的反映在請求上，不能只是畫面上點亮
  it('首次載入帶的是 range=30d', async () => {
    await open()

    expect(state.ranges).toEqual(['30d'])
  })

  // 4-2：兩排控制項都用真的 <button> 並標好選中狀態，不要只靠顏色
  it('兩排控制項都是 button，選中狀態標在 aria-pressed 上', async () => {
    const page = await open()

    for (const control of [...page.findAll('[data-testid="parameter-tab"]'), ...page.findAll('[data-testid="range-button"]')]) {
      expect(control.element.tagName).toBe('BUTTON')
      expect(control.attributes('type')).toBe('button')
      expect(control.attributes('aria-pressed')).toMatch(/^(true|false)$/)
    }
  })
})

describe('趨勢 — 最新值與變化量', () => {
  // Given 我選中 KH 且範圍為 30 天 / When 圖表渲染
  // Then 上方大字顯示該區間最新一筆的值與單位（如「7.8 dKH」）
  it('大字顯示最新一筆的值，旁邊是單位', async () => {
    const page = await open()

    expect(page.get('[data-testid="trend-latest"]').text()).toBe('7.8')
    expect(page.get('[data-testid="trend-unit"]').text()).toBe('dKH')
  })

  // And 右側顯示期間變化量與方向（如「▼ 0.4（7 天）」），下降為藍色 ▼
  it('下降時顯示「▼ 0.4（7 天）」並且是藍色', async () => {
    const page = await open()
    const change = page.get('[data-testid="trend-change"]')

    expect(change.attributes('data-direction')).toBe('down')
    expect(changeText(page)).toContain('▼')
    expect(page.get('[data-testid="trend-change-value"]').text()).toBe('0.4（7 天）')
    expect(change.classes()).toContain('text-blue-400')
  })

  // 上升為橘色 ▲。這是「方向」不是「好壞」，所以不畫成紅綠（issue #123 第 4-4 節）
  it('上升時顯示「▲」並且是橘色', async () => {
    const page = await open()

    await selectParameter(page, 'CA')

    const change = page.get('[data-testid="trend-change"]')

    expect(change.attributes('data-direction')).toBe('up')
    expect(changeText(page)).toContain('▲')
    expect(page.get('[data-testid="trend-change-value"]').text()).toBe('10（7 天）')
    expect(change.classes()).toContain('text-orange-400')
  })

  // 箭頭本身不該被螢幕報讀器唸成「黑色下三角形」，方向另外給一個字
  it('方向除了箭頭之外還有文字，箭頭本身不報讀', async () => {
    const page = await open()

    expect(page.get('[data-testid="trend-change"] [aria-hidden="true"]').text()).toBe('▼')
    expect(changeText(page)).toContain('下降')
  })

  // 真的量了兩次而讀值一樣時是「持平」，不是「▲ 0」——後者看起來像上升了 0
  it('兩筆讀值相同時顯示持平，不畫箭頭', async () => {
    state.pages['30d'] = trendPage('30d', { ...DEFAULT_SPECS, KH: [[7, 8], [0, 8]] })

    const page = await open()

    expect(page.get('[data-testid="trend-change"]').attributes('data-direction')).toBe('flat')
    expect(changeText(page)).not.toContain('▲')
    expect(changeText(page)).not.toContain('▼')
    expect(page.get('[data-testid="trend-change-value"]').text()).toBe('持平（7 天）')
  })
})

describe('趨勢 — 折線圖', () => {
  // Given 我選中某個元素 / When 折線圖渲染
  // Then 以量測時間為 X 軸、讀值為 Y 軸繪製折線與資料點
  it('畫出一條折線，座標數等於該區間的讀值筆數', async () => {
    const page = await open()
    const lines = seriesLines(page)

    expect(lines).toHaveLength(1)
    expect(coordinateCount(lines[0]!.attributes('d') ?? '')).toBe(DEFAULT_SPECS.KH.length)
  })

  // 圖是 SVG 而不是 canvas，上面每一條斷言才寫得出來（#140 的取捨）
  it('圖畫在 SVG 上，不是 canvas', async () => {
    const page = await open()

    expect(page.get('[data-testid="line-chart"]').find('svg').exists()).toBe(true)
    expect(page.find('canvas').exists()).toBe(false)
  })

  // And 圖表背景以色帶標示該元素的正常區間（如 KH 的 7–9）
  it('背景色帶用的是該元素的正常區間', async () => {
    const page = await open()

    expect(page.findComponent(LineChart).props('band')).toEqual({ min: 7, max: 9 })
    expect(bandShapes(page)).toHaveLength(1)
  })

  // 色帶落在 Y 軸範圍外會被裁成整片背景，看起來像「整個區間都正常」
  it('Y 軸涵蓋正常區間的上下界', async () => {
    const page = await open()
    const values = tickTexts(page).filter(isNumericTick).map(Number)

    expect(values.length).toBeGreaterThan(0)
    expect(Math.min(...values)).toBeLessThanOrEqual(7)
    expect(Math.max(...values)).toBeGreaterThanOrEqual(9)
  })

  // And X 軸顯示區間內的日期刻度（如 6/08、6/22、7/04）
  it('X 軸是日期刻度', async () => {
    const page = await open()

    expect(tickTexts(page).filter(text => DATE_TICK.test(text)).length).toBeGreaterThanOrEqual(2)
  })

  // 餵給包裝元件的是「一串帶時間的讀值」，頁面不自己碰 echarts 的 option 物件（4-1）
  it('餵給圖表的是該測項的點，順序由舊到新', async () => {
    const page = await open()
    const points = page.findComponent(LineChart).props('points') as { measuredAt: string, value: number }[]

    expect(points.map(point => point.value)).toEqual([8.1, 7.9, 8.2, 7.8])
    expect(points.map(point => new Date(point.measuredAt).getTime()))
      .toEqual([...points.map(point => new Date(point.measuredAt).getTime())].sort((a, b) => a - b))
  })
})

describe('趨勢 — 切換元素', () => {
  // Given 我點擊另一個元素 tab（如 Ca）/ When 切換完成
  // Then 折線、正常範圍帶、單位、統計摘要全部改為該元素的資料
  it('折線、色帶、單位與統計摘要全部換成該元素的', async () => {
    const page = await open()

    await selectParameter(page, 'CA')

    const chart = page.findComponent(LineChart)

    expect((chart.props('points') as { value: number }[]).map(point => point.value)).toEqual([400, 410, 420])
    expect(chart.props('band')).toEqual({ min: 380, max: 450 })
    expect(page.get('[data-testid="trend-latest"]').text()).toBe('420')
    expect(page.get('[data-testid="trend-unit"]').text()).toBe('ppm')
    expect(statTexts(page)).toEqual(['410', '420', '400'])
  })

  it('選中狀態跟著移到被點的那一個 tab', async () => {
    const page = await open()

    await selectParameter(page, 'CA')

    expect(tab(page, 'KH').attributes('aria-pressed')).toBe('false')
    expect(tab(page, 'CA').attributes('aria-pressed')).toBe('true')
  })

  // And 不重新發出網路請求（六個測項在同一份回應裡）
  it('切 tab 不重新發出網路請求', async () => {
    const page = await open()

    expect(state.ranges).toEqual(['30d'])

    for (const parameter of ['CA', 'MG', 'NO3', 'PO4', 'SALINITY', 'KH'] as const) {
      await selectParameter(page, parameter)
    }

    expect(state.ranges).toEqual(['30d'])
  })
})

describe('趨勢 — 切換時間範圍', () => {
  beforeEach(() => {
    state.pages['90d'] = trendPage('90d', NINETY_DAY_SPECS)
  })

  // Given 我切換時間範圍為 7 天 / 90 天 / 全部 / When 切換完成
  // Then 折線只包含該區間內的量測，統計摘要與變化量依該區間重新計算
  it('切到 90 天後重新請求，折線與統計換成該區間的', async () => {
    const page = await open()

    await selectRange(page, '90d')

    expect(state.ranges).toEqual(['30d', '90d'])
    expect((page.findComponent(LineChart).props('points') as { value: number }[]).map(point => point.value))
      .toEqual([9, 8.6, 9.1])
    expect(page.get('[data-testid="trend-latest"]').text()).toBe('9.1')
    expect(statTexts(page)).toEqual(['8.9', '9.1', '8.6'])
    expect(page.get('[data-testid="trend-change-value"]').text()).toBe('0.5（40 天）')
  })

  it('選中狀態跟著移到被點的那一顆', async () => {
    const page = await open()

    await selectRange(page, '90d')

    expect(rangeButton(page, '30d').attributes('aria-pressed')).toBe('false')
    expect(rangeButton(page, '90d').attributes('aria-pressed')).toBe('true')
  })

  it.each([['7d'], ['all']] as const)('切到 %s 也會帶著那個區間重新請求', async (range) => {
    const page = await open()

    await selectRange(page, range)

    expect(state.ranges).toEqual(['30d', range])
  })

  // And 換範圍期間畫面不閃成空狀態（舊圖留著，直到新資料到）
  it('換範圍期間舊圖留著，不退回骨架也不閃空狀態', async () => {
    const page = await open()

    state.hold.trends = gate()

    // 刻意不 await：要看的正是中間那一拍
    void rangeButton(page, '90d').trigger('click')
    await flushPromises()

    expect(page.find('[data-testid="trends-loading"]').exists()).toBe(false)
    expect(page.find('[data-testid="trend-chart-empty"]').exists()).toBe(false)
    expect(seriesLines(page)).toHaveLength(1)
    // 舊圖仍是 30 天那一份，同時要有「還在更新」的樣態
    expect(page.get('[data-testid="trend-latest"]').text()).toBe('7.8')
    expect(page.get('[data-testid="trends-refreshing"]').exists()).toBe(true)

    state.hold.trends.open()
    await settle()

    await vi.waitFor(() => {
      expect(page.get('[data-testid="trend-latest"]').text()).toBe('9.1')
    })
    expect(page.find('[data-testid="trends-refreshing"]').exists()).toBe(false)
  })
})

describe('趨勢 — 統計摘要', () => {
  // Given 我選中的元素在該區間有多筆讀值 / When 統計摘要渲染
  // Then 顯示「平均 / 最高 / 最低」三個數值
  it('顯示平均 / 最高 / 最低三格', async () => {
    const page = await open()

    expect(page.findAll('[data-testid="trend-stat"]').map(stat => stat.attributes('data-stat')))
      .toEqual(['average', 'highest', 'lowest'])
    expect(page.findAll('[data-testid="trend-stat-label"]').map(label => label.text()))
      .toEqual(['平均', '最高', '最低'])
    expect(statTexts(page)).toEqual(['8.0', '8.2', '7.8'])
  })

  // And 全部取自 API 回傳，不在前端重算。
  // 夾具刻意把 average 改成與那幾個點對不起來的值：畫面若自己算一次就會顯示 8.0。
  it('平均直接取 API 給的值，不在前端重算', async () => {
    const page = trendPage('30d', DEFAULT_SPECS)

    page.series.find(series => series.parameter === 'KH')!.average = 6.5
    state.pages['30d'] = page

    expect(statTexts(await open())[0]).toBe('6.5')
  })
})

describe('趨勢 — 這個區間沒有讀值', () => {
  beforeEach(() => {
    state.pages['30d'] = trendPage('30d', { ...DEFAULT_SPECS, KH: [] })
  })

  // Given 我選中的元素在該區間沒有任何讀值 / When 畫面渲染
  // Then 圖表區顯示空狀態文案
  it('圖表區顯示空狀態文案，不畫圖', async () => {
    const page = await open()

    expect(page.get('[data-testid="trend-chart-empty"]').text()).toContain('KH')
    expect(page.find('[data-testid="line-chart"]').exists()).toBe(false)
  })

  // And 統計摘要與變化量不顯示數字
  it('三格統計顯示「—」，變化量整塊不顯示', async () => {
    const page = await open()

    expect(statTexts(page)).toEqual(['—', '—', '—'])
    expect(page.get('[data-testid="trend-latest"]').text()).toBe('—')
    expect(page.find('[data-testid="trend-change"]').exists()).toBe(false)
  })

  it('畫面上不出現 NaN', async () => {
    expect((await open()).text()).not.toContain('NaN')
  })

  // 六個 tab 永遠都在：沒有讀值的測項是「空序列」而不是缺席，
  // 而且要留著切回去的路（切到別的測項就有資料了）
  it('六個 tab 與四顆範圍按鈕照樣都在', async () => {
    const page = await open()

    expect(page.findAll('[data-testid="parameter-tab"]')).toHaveLength(6)
    expect(page.findAll('[data-testid="range-button"]')).toHaveLength(4)

    await selectParameter(page, 'CA')

    expect(page.get('[data-testid="trend-latest"]').text()).toBe('420')
  })
})

describe('趨勢 — 這個區間只有一筆讀值', () => {
  beforeEach(() => {
    state.pages['30d'] = trendPage('30d', { ...DEFAULT_SPECS, KH: [[0, 7.8]] })
  })

  // Given 我選中的元素在該區間只有一筆讀值 / When 畫面渲染
  // Then 圖表顯示單一資料點，不得畫出一條假的線
  it('圖上只有那一個點，沒有折線', async () => {
    const page = await open()

    expect(page.get('[data-testid="line-chart"]').exists()).toBe(true)
    expect(page.find('[data-testid="trend-chart-empty"]').exists()).toBe(false)

    for (const line of seriesLines(page)) {
      expect(coordinateCount(line.attributes('d') ?? '')).toBeLessThanOrEqual(1)
    }
  })

  // And 變化量不顯示（一筆算不出「變化」），也不得出現 NaN
  it('變化量不顯示，畫面上沒有 NaN', async () => {
    const page = await open()

    expect(page.find('[data-testid="trend-change"]').exists()).toBe(false)
    expect(page.get('[data-testid="trend-latest"]').text()).toBe('7.8')
    expect(page.text()).not.toContain('NaN')
  })

  // 一筆讀值仍然算得出平均 / 最高 / 最低（三者都是它自己），不該退成「—」
  it('三格統計仍然是那一筆的值', async () => {
    expect(statTexts(await open())).toEqual(['7.8', '7.8', '7.8'])
  })
})

describe('趨勢 — 資料還在路上', () => {
  // Given 資料還在路上（#84 之後是 SPA，首屏沒有伺服器算好的畫面）/ When 畫面渲染
  // Then 顯示載入樣態，不得先閃一次「這個區間沒有資料」
  it('載入中顯示骨架，不先閃空狀態', async () => {
    state.hold.trends = gate()

    const page = await open()

    expect(page.get('[data-testid="trends-loading"]').exists()).toBe(true)
    expect(page.find('[data-testid="trend-chart-empty"]').exists()).toBe(false)
    expect(page.find('[data-testid="tank-empty"]').exists()).toBe(false)

    state.hold.trends.open()
    await settle()

    expect(page.find('[data-testid="trends-loading"]').exists()).toBe(false)
    expect(page.get('[data-testid="trend-latest"]').text()).toBe('7.8')
  })
})

describe('趨勢 — 取資料失敗', () => {
  // Given 請求失敗（網路中斷、500）/ When 畫面渲染
  // Then 顯示「載入失敗」與重試，而不是畫成「你沒有資料」（#132 / #133）
  it('缸清單回 500 時顯示載入失敗與重試', async () => {
    state.fail.tanks = true

    const page = await open()

    expect(page.get('[data-testid="load-error"]').text()).toContain('載入失敗')
    expect(page.get('[data-testid="load-error-retry"]').exists()).toBe(true)
    expect(page.find('[data-testid="trend-chart-empty"]').exists()).toBe(false)
    expect(page.find('[data-testid="tank-empty"]').exists()).toBe(false)
  })

  it('趨勢資料回 500 時同樣顯示載入失敗，不畫成空的圖', async () => {
    state.fail.trends = true

    const page = await open()

    expect(page.get('[data-testid="load-error"]').exists()).toBe(true)
    expect(page.find('[data-testid="line-chart"]').exists()).toBe(false)
    expect(page.find('[data-testid="trend-chart-empty"]').exists()).toBe(false)
  })

  // 頁首的「趨勢」是常駐的 h1，錯誤區塊再給一個就變成同一頁兩個 h1
  it('載入失敗時整頁仍然只有一個 h1', async () => {
    state.fail.tanks = true

    const page = await open()
    const headings = page.findAll('h1')

    expect(headings).toHaveLength(1)
    expect(headings[0]!.text()).toBe('趨勢')
    expect(page.get('[data-testid="load-error-title"]').text()).toBe('載入失敗')
  })

  it('點「重試」重新發出請求，成功後正常顯示', async () => {
    state.fail.tanks = true

    const page = await open()

    expect(page.get('[data-testid="load-error"]').exists()).toBe(true)

    state.fail.tanks = false

    await page.get('[data-testid="load-error-retry"]').trigger('click')
    await settle()

    await vi.waitFor(() => {
      expect(page.find('[data-testid="load-error"]').exists()).toBe(false)
      expect(page.get('[data-testid="trend-latest"]').text()).toBe('7.8')
    })
  })

  // 重試期間 status 會從 'error' 翻成 'pending'，「只看 error」的寫法會在那一段
  // 把錯誤區塊拆掉，畫面於是閃過一次骨架或空狀態
  it('重試進行中畫面停在載入失敗', async () => {
    state.fail.tanks = true

    const page = await open()

    state.fail.tanks = false
    state.hold.trends = gate()

    void page.get('[data-testid="load-error-retry"]').trigger('click')
    await flushPromises()

    expect(page.get('[data-testid="load-error"]').exists()).toBe(true)
    expect(page.find('[data-testid="trends-loading"]').exists()).toBe(false)
    expect(page.find('[data-testid="trend-chart-empty"]').exists()).toBe(false)
    expect(page.get('[data-testid="load-error-retry"]').attributes('disabled')).toBeDefined()

    state.hold.trends.open()

    await vi.waitFor(() => {
      expect(page.find('[data-testid="load-error"]').exists()).toBe(false)
    })
  })
})

describe('趨勢 — 尚未建立任何缸', () => {
  // 趨勢是某一個缸的趨勢，沒有缸就沒有東西可畫。這一態要與「載入失敗」分得出來
  it('沒有任何缸時顯示建立缸的入口，不顯示圖表與 tab', async () => {
    state.tanks = []

    const page = await open()

    expect(page.get('[data-testid="tank-empty"]').text()).toContain('還沒有任何缸')
    expect(page.get('[data-testid="tank-empty-action"]').attributes('href')).toBe('/tanks/new')
    expect(page.find('[data-testid="load-error"]').exists()).toBe(false)
    expect(page.findAll('[data-testid="parameter-tab"]')).toHaveLength(0)
    // 缸都沒有就不必問趨勢
    expect(state.ranges).toEqual([])
  })
})
