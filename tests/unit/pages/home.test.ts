import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import HomePage from '../../../app/pages/index.vue'
import BottomTabBar from '../../../app/components/BottomTabBar.vue'
import { signedInUserSession } from '../support/session'
import { SCROLL_RESTORE_MAX_FRAMES } from '../../../app/composables/useScrollRestore'
import type { CreatureDto, TankHomeData, TankOption } from '#shared/types/home'
import { HEADER_COLLAPSE_AT, HEADER_EXPAND_BELOW } from '#shared/utils/stickyHeader'
import { scrollRestoreKey, serializeScrollMark } from '#shared/utils/scrollRestore'

const MAIN_TANK: TankOption = {
  id: 'tank-1',
  name: '主缸',
  sizeSpec: '4 尺',
  volumeLiters: 420,
  setupType: 'SPS MIXED',
  colorHex: '#2dd4bf',
}

const SECOND_TANK: TankOption = {
  id: 'tank-2',
  name: '軟體缸',
  sizeSpec: '2 尺',
  volumeLiters: 120,
  setupType: 'SOFT',
  colorHex: '#a78bfa',
}

// 相對時間與入缸月數都是「相對現在」的推算值，
// 固定資料 + 真實時鐘會隨日期漂移，所以夾具反過來由現在往回推。
const FOUR_HOURS_AGO = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()

// ⚠ 不能直接 `setUTCMonth(getUTCMonth() - months)`：目標月份沒有今天這一號時，
// Date 會往後正規化到下個月的 1 號（今天 31 號、目標月只有 30 天 → 落在下個月），
// 推出來的日期因此少了整整一個月。只有「今天的號數 > 目標月份的天數」那幾天會炸
// （2026–2027 兩年間共 58 天），所以能潛伏很久。先夾到目標月實際的最後一天再組日期。
function monthsAgo(months: number): string {
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() - months

  // 該月的第 0 天 ＝ 前一個月的最後一天，用它取得目標月的天數
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()

  return new Date(Date.UTC(year, month, Math.min(now.getUTCDate(), lastDayOfTargetMonth)))
    .toISOString()
    .slice(0, 10)
}

function creature(overrides: Partial<CreatureDto> & Pick<CreatureDto, 'id' | 'name'>): CreatureDto {
  return {
    category: 'FISH',
    status: 'ALIVE',
    photoUrl: null,
    addedOn: monthsAgo(8),
    ailment: null,
    diedOn: null,
    ...overrides,
  }
}

// Given 該缸有 12 隻生物：魚 5、珊瑚 6、其他 1（其中兩隻同名的「公子小丑」）
const MAIN_TANK_CREATURES: CreatureDto[] = [
  creature({ id: 'f1', name: '藍倒吊' }),
  creature({ id: 'f2', name: '黃三角', status: 'SICK', ailment: '白點' }),
  creature({ id: 'f3', name: '公子小丑', addedOn: monthsAgo(10) }),
  creature({ id: 'f4', name: '公子小丑', addedOn: monthsAgo(10) }),
  creature({ id: 'f5', name: '六線龍', status: 'DEAD', addedOn: monthsAgo(6), diedOn: monthsAgo(3) }),
  ...Array.from({ length: 6 }, (_, index) => creature({
    id: `c${index}`,
    name: `珊瑚${index}`,
    category: 'CORAL',
  })),
  creature({ id: 'o1', name: '海星', category: 'OTHER' }),
]

// Given 該缸最新一筆水質記錄為 4 小時前，其中 Mg 低於正常區間、NO₃ 高於正常區間
const MAIN_TANK_HOME: TankHomeData = {
  water: {
    measuredAt: FOUR_HOURS_AGO,
    readings: [
      { parameter: 'KH', value: 7.8 },
      { parameter: 'CA', value: 412 },
      { parameter: 'MG', value: 1180 },
      { parameter: 'NO3', value: 12 },
      { parameter: 'PO4', value: 0.04 },
      { parameter: 'SALINITY', value: 1.026 },
    ],
    targets: [
      { parameter: 'MG', minValue: 1250, maxValue: 1350 },
      { parameter: 'NO3', minValue: 2, maxValue: 10 },
    ],
    // 儀表板的迷你趨勢線：Mg 一路下滑、NO₃ 一路上升，正好解釋最新一筆的兩個異常
    trends: [
      { parameter: 'KH', values: [7.6, 7.9, 7.8] },
      { parameter: 'MG', values: [1300, 1260, 1180] },
      { parameter: 'NO3', values: [9, 10.5, 12] },
    ],
  },
  creatures: MAIN_TANK_CREATURES,
}

const SECOND_TANK_HOME: TankHomeData = {
  water: null,
  creatures: [creature({ id: 's1', name: '雪花', category: 'CORAL' })],
}

const state = {
  tanks: [] as TankOption[],
  home: {} as Record<string, TankHomeData>,
}

// 首頁要登入才進得去（#67 的全域路由保護）。少了這張 session，mountSuspended
// 的導覽會先被導去 /login，頁面就讀不到網址上的 ?tank=<id>。
mockNuxtImport('useUserSession', () => () => signedInUserSession())

registerEndpoint('/api/tanks', () => ({ tanks: state.tanks }))
registerEndpoint('/api/tanks/tank-1/home', () => state.home['tank-1'] ?? { water: null, creatures: [] })
registerEndpoint('/api/tanks/tank-2/home', () => state.home['tank-2'] ?? { water: null, creatures: [] })

// 上一題掛著沒拆的頁面會共用同一組 useAsyncData key，
// clearNuxtData() 讓它的 watcher 跟著醒過來去搶同一份資料。每題結束就拆掉。
enableAutoUnmount(afterEach)

beforeEach(() => {
  // useAsyncData 的結果會留在 payload 上，測試之間必須清掉才不會拿到上一題的缸
  clearNuxtData()

  // scrollY 是掛在共用的 window 上的，上一題捲到哪裡會被下一題的頁面在掛載時讀到
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })

  state.tanks = [MAIN_TANK]
  state.home = { 'tank-1': MAIN_TANK_HOME, 'tank-2': SECOND_TANK_HOME }
})

function chipTexts(page: Awaited<ReturnType<typeof mountSuspended>>) {
  return page.findAll('[data-testid="creature-chip"]').map(chip => chip.text())
}

// 由上而下的五個區塊，各取一個代表元素。querySelectorAll 依文件順序回傳，
// 所以這個陣列就是版面的實際排列。
const LAYOUT_LANDMARKS = [
  'tank-color',
  'water-title',
  'creature-total',
  'creature-chip',
  'creature-card',
] as const

function layoutOrder(page: Awaited<ReturnType<typeof mountSuspended>>) {
  const selector = LAYOUT_LANDMARKS.map(id => `[data-testid="${id}"]`).join(', ')
  const seen: string[] = []

  for (const element of page.element.querySelectorAll(selector)) {
    const id = element.getAttribute('data-testid')!

    if (!seen.includes(id)) {
      seen.push(id)
    }
  }

  return seen
}

/** 從 class 陣列取出 z-<n> 的數值，用來比較兩層誰在上面 */
function zIndexOf(classes: string[]): number {
  const layer = classes.find(name => /^z-\d+$/.test(name))

  expect(layer, `預期 class 中有 z-<n>，實際為 ${classes.join(' ')}`).toBeDefined()

  return Number(layer!.slice(2))
}

/** 只搬動捲動位置，不送事件——用來模擬「掛載時瀏覽器已經還原到某個位置」 */
function setScrollY(offset: number) {
  Object.defineProperty(window, 'scrollY', { value: offset, configurable: true })
}

/** 捲動到指定位置：改 scrollY 再送出 scroll 事件，頁面靠監聽器決定要不要收合 */
function scrollTo(offset: number) {
  setScrollY(offset)
  window.dispatchEvent(new Event('scroll'))
}

function isCollapsed(page: Awaited<ReturnType<typeof mountSuspended>>) {
  return page.get('[data-testid="home-sticky-header"]').attributes('data-collapsed')
}

function readingsSlot(page: Awaited<ReturnType<typeof mountSuspended>>) {
  return page.get('[data-testid="water-readings-slot"]')
}

function subtitleSlot(page: Awaited<ReturnType<typeof mountSuspended>>) {
  return page.get('[data-testid="tank-subtitle-slot"]')
}

/**
 * 等首幀的「這一幀不要動」旗標解除。
 *
 * 過場只在這之後才開放，所以凡是要看「翻轉時發生什麼」的測試都得先等它，
 * 不然驗到的是首次掛載那一幀的樣態。
 */
async function afterFirstFrame(page: Awaited<ReturnType<typeof mountSuspended>>) {
  await vi.waitFor(() => {
    expect(page.get('[data-testid="home-sticky-header"]').attributes('data-animated')).toBe('true')
  })
}

describe('首頁 — 頁首', () => {
  // Given 我有一個名為「主缸」的缸，設定為 4 尺 / SPS MIXED / 420L / When 我開啟首頁
  // Then 頁首顯示缸的代表色塊、缸名「主缸 · 4 尺」與副標「SPS MIXED · 420L」，缸名右側有可切換的 ∨
  it('顯示當前缸的名稱、副標與色塊', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })

    expect(page.get('h1').text()).toBe('主缸 · 4 尺')
    expect(page.get('[data-testid="tank-subtitle"]').text()).toBe('SPS MIXED · 420L')
    expect(page.get('[data-testid="tank-color"]').attributes('data-color')).toBe('#2dd4bf')
    expect(page.get('[data-testid="tank-switch"]').exists()).toBe(true)
  })

  // Given 我有兩個以上未封存的缸 / When 我點擊缸名旁的 ∨ / Then 出現缸切換選單
  // When 我選擇另一個缸 / Then 首頁的水質摘要與生物列表改為顯示該缸的資料
  it('切換缸之後水質摘要與生物列表改看該缸的資料', async () => {
    state.tanks = [MAIN_TANK, SECOND_TANK]

    const page = await mountSuspended(HomePage, { route: '/' })

    expect(page.get('[data-testid="water-attention"]').text()).toBe('2 需注意')
    expect(page.get('[data-testid="creature-total"]').text()).toBe('12 隻')

    await page.get('[data-testid="tank-switch"]').trigger('click')
    await page.get('[data-testid="tank-menu"]').findAll('[role="option"]')[1]!.trigger('click')
    await flushPromises()

    // 換缸會重打 /api/tanks/:id/home，等那一輪回來再驗（頁首因為資料已在手上，會先一步更新）
    await vi.waitFor(() => {
      expect(page.get('[data-testid="creature-total"]').text()).toBe('1 隻')
    })

    expect(page.get('h1').text()).toBe('軟體缸 · 2 尺')
    expect(page.find('[data-testid="water-attention"]').exists()).toBe(false)
    expect(page.get('[data-testid="water-empty"]').exists()).toBe(true)
    expect(page.findAll('[data-testid="creature-card"]')).toHaveLength(1)
    expect(page.get('[data-testid="creature-title"]').text()).toBe('雪花')
  })
})

describe('首頁 — 水質摘要列', () => {
  // Then 水質摘要列顯示「水質」標題、橘色徽章「2 需注意」與相對時間「· 4h」
  // And 六項元素 KH / Ca / Mg / NO₃ / PO₄ / 鹽 以彩色數字並排顯示
  it('顯示需注意數量、相對時間與六項彩色數字', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })

    expect(page.get('[data-testid="water-attention"]').text()).toBe('2 需注意')
    expect(page.get('[data-testid="water-measured-at"]').text()).toBe('· 4h')
    expect(page.findAll('[data-testid="water-reading"]')).toHaveLength(6)
    expect(
      page.findAll('[data-testid="water-reading-value"]').map(value => value.attributes('data-status')),
    ).toEqual(['normal', 'normal', 'low', 'high', 'normal', 'normal'])
  })

  // Given 該缸尚無任何水質記錄 / Then 顯示空狀態，並提供前往記錄水質的入口
  it('沒有水質記錄時顯示空狀態與記錄入口', async () => {
    state.home = { 'tank-1': { water: null, creatures: MAIN_TANK_CREATURES } }

    const page = await mountSuspended(HomePage, { route: '/' })

    expect(page.find('[data-testid="water-attention"]').exists()).toBe(false)
    expect(page.find('[data-testid="water-measured-at"]').exists()).toBe(false)
    expect(page.get('[data-testid="water-empty-action"]').attributes('href')).toBe('/log')
  })
})

// issue #10：點一下水質摘要列，由下方升起完整的數據儀表板。
describe('首頁 — 數據儀表板（bottom sheet）', () => {
  /** 點水質摘要列展開儀表板 */
  async function openDashboard(page: Awaited<ReturnType<typeof mountSuspended>>) {
    await page.get('[data-testid="water-summary-row"]').trigger('click')
    await flushPromises()
  }

  // Given 我在首頁，水質摘要列為收合狀態 / When 我點擊水質摘要列（或「詳細 ∨」）
  // Then 由下方升起 bottom sheet，標題為「數據儀表板」，副標為「<缸名> · 更新於 N 小時前」
  it('點擊水質摘要列後升起儀表板，標題與副標帶著缸名與相對時間', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })

    // 一開始是收合的，畫面上沒有儀表板
    expect(page.find('[data-testid="water-dashboard"]').exists()).toBe(false)

    await openDashboard(page)

    expect(page.get('[data-testid="water-dashboard-title"]').text()).toBe('數據儀表板')
    expect(page.get('[data-testid="water-dashboard-subtitle"]').text()).toBe('主缸 · 更新於 4 小時前')
  })

  // Then 依序列出 KH / Ca / Mg / NO₃ / PO₄ / 鹽度六列
  it('六列測項連同數值、單位、狀態與區間一起出現', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })
    await openDashboard(page)

    expect(page.findAll('[data-testid="water-dashboard-row"]')).toHaveLength(6)
    expect(
      page.findAll('[data-testid="water-dashboard-label"]').map(label => label.text()),
    ).toEqual(['KH', 'Ca', 'Mg', 'NO₃', 'PO₄', '鹽度'])
    expect(
      page.findAll('[data-testid="water-dashboard-status"]').map(status => status.text()),
    ).toEqual(['正常', '正常', '偏低 ▼', '偏高 ▲', '正常', '正常'])
  })

  // And 背景首頁內容變暗但仍可見
  it('展開時首頁內容仍在，只是被遮罩壓暗', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })
    await openDashboard(page)

    expect(page.get('[data-testid="water-dashboard-backdrop"]').exists()).toBe(true)

    // 首頁沒有被換掉：頁首、摘要列與生物卡片都還在
    expect(page.get('h1').text()).toBe('主缸 · 4 尺')
    expect(page.get('[data-testid="water-attention"]').text()).toBe('2 需注意')
    expect(page.findAll('[data-testid="creature-card"]')).toHaveLength(11)
  })

  // Given 儀表板已展開 / When 我點擊右上角 ✕ / Then bottom sheet 收合，回到首頁預設狀態
  it('點擊 ✕ 後收合，回到首頁預設狀態', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })
    await openDashboard(page)

    await page.get('[data-testid="water-dashboard-close"]').trigger('click')
    await flushPromises()

    expect(page.find('[data-testid="water-dashboard"]').exists()).toBe(false)
    expect(page.get('[data-testid="water-summary-row"]').exists()).toBe(true)
    expect(page.findAll('[data-testid="water-reading"]')).toHaveLength(6)
  })

  // When 我點擊背景遮罩 / Then bottom sheet 收合
  it('點擊背景遮罩後收合', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })
    await openDashboard(page)

    await page.get('[data-testid="water-dashboard-backdrop"]').trigger('click')
    await flushPromises()

    expect(page.find('[data-testid="water-dashboard"]').exists()).toBe(false)
  })

  // When 我向下拖曳把手 / Then bottom sheet 收合
  it('向下拖曳把手後收合', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })
    await openDashboard(page)

    await page.get('[data-testid="water-dashboard-handle"]').trigger('pointerdown', { clientY: 100 })
    await page.get('[data-testid="water-dashboard"]').trigger('pointermove', { clientY: 220 })
    await page.get('[data-testid="water-dashboard"]').trigger('pointerup', { clientY: 220 })
    await flushPromises()

    expect(page.find('[data-testid="water-dashboard"]').exists()).toBe(false)
  })

  // When 我點擊底部的「＋ 記錄水質」主要按鈕 / Then bottom sheet 關閉並導向「記錄水質」頁面
  it('「＋ 記錄水質」連向 /log，點下去同時收合儀表板', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })
    await openDashboard(page)

    const action = page.get('[data-testid="water-dashboard-log"]')
    expect(action.attributes('href')).toBe('/log')

    await action.trigger('click')
    await flushPromises()

    expect(page.find('[data-testid="water-dashboard"]').exists()).toBe(false)
  })

  // 頁面捲下去、摘要列收合成單行 pill 之後，它仍然是同一個入口
  it('頁首收合狀態下點摘要列一樣展開儀表板', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })

    scrollTo(1200)
    await flushPromises()
    expect(isCollapsed(page)).toBe('true')

    await openDashboard(page)

    expect(page.get('[data-testid="water-dashboard-title"]').text()).toBe('數據儀表板')
  })

  // Given 該缸尚無任何水質記錄：沒有東西可攤開，摘要列維持它自己的空狀態入口
  it('沒有水質記錄的缸點摘要列不會展開儀表板', async () => {
    state.home = { 'tank-1': { water: null, creatures: MAIN_TANK_CREATURES } }

    const page = await mountSuspended(HomePage, { route: '/' })

    await openDashboard(page)

    expect(page.find('[data-testid="water-dashboard"]').exists()).toBe(false)
    expect(page.get('[data-testid="water-empty-action"]').attributes('href')).toBe('/log')
  })
})

describe('首頁 — 生物區', () => {
  // Then 「生物」標題右側顯示「12 隻」，並有 4 個分類 chip：全部 / 魚 5 / 珊瑚 6 / 其他 1
  it('顯示總隻數與四個分類 chip', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })

    expect(page.get('[data-testid="creature-total"]').text()).toBe('12 隻')
    expect(chipTexts(page)).toEqual(['全部', '魚 5', '珊瑚 6', '其他 1'])
  })

  it('預設選中「全部」，同名的公子小丑合併為一張 ×2 卡片', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })

    const chips = page.findAll('[data-testid="creature-chip"]')
    expect(chips.map(chip => chip.attributes('aria-pressed'))).toEqual(['true', 'false', 'false', 'false'])

    // 12 隻扣掉合併掉的那一隻公子小丑 = 11 張卡片
    const titles = page.findAll('[data-testid="creature-title"]').map(title => title.text())
    expect(titles).toHaveLength(11)
    expect(titles).toContain('公子小丑 ×2')
  })

  // When 我點擊「魚 5」/ Then 卡片網格只顯示 category 為 FISH 的生物，該 chip 呈選中態
  it('點擊「魚 5」後只顯示魚，且該 chip 呈選中態', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })

    await page.findAll('[data-testid="creature-chip"]')[1]!.trigger('click')

    const chips = page.findAll('[data-testid="creature-chip"]')
    expect(chips.map(chip => chip.attributes('aria-pressed'))).toEqual(['false', 'true', 'false', 'false'])

    const titles = page.findAll('[data-testid="creature-title"]').map(title => title.text())
    expect(titles).toEqual(['藍倒吊', '黃三角', '公子小丑 ×2', '六線龍'])
    expect(page.findAll('[data-testid="creature-category"]').every(label => label.text() === '魚')).toBe(true)
  })

  it('點擊「珊瑚 6」後只顯示珊瑚', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })

    await page.findAll('[data-testid="creature-chip"]')[2]!.trigger('click')

    expect(page.findAll('[data-testid="creature-card"]')).toHaveLength(6)
    expect(page.findAll('[data-testid="creature-category"]').every(label => label.text() === '珊瑚')).toBe(true)
  })

  // Given 我在首頁 / When 我點擊任一張生物卡片 / Then 導向該生物的「生物詳情」頁
  it('每張卡片都連向該生物的詳情頁', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })
    const first = page.findAll('[data-testid="creature-card"]')[0]!

    expect(first.get('a').attributes('href')).toBe('/creatures/f1')
  })

  it('沒有任何生物時顯示空狀態', async () => {
    state.home = { 'tank-1': { water: null, creatures: [] } }

    const page = await mountSuspended(HomePage, { route: '/' })

    expect(page.get('[data-testid="creature-total"]').text()).toBe('0 隻')
    expect(page.findAll('[data-testid="creature-card"]')).toHaveLength(0)
    expect(page.get('[data-testid="creature-empty"]').exists()).toBe(true)
  })
})

describe('首頁 — sticky 頁首（捲動時收合）', () => {
  // Given 我在首頁，頁面尚未捲動 / When 畫面渲染
  // Then 缸別頁首、水質摘要列（含六項元素）、生物標題列、分類 chip 列、卡片網格
  //      由上而下完整顯示，與現況一致
  it('尚未捲動時，五個區塊由上而下完整顯示', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })

    expect(layoutOrder(page)).toEqual([
      'tank-color',
      'water-title',
      'creature-total',
      'creature-chip',
      'creature-card',
    ])
    expect(isCollapsed(page)).toBe('false')
    expect(page.get('[data-testid="tank-subtitle"]').text()).toBe('SPS MIXED · 420L')
    expect(page.findAll('[data-testid="water-reading"]')).toHaveLength(6)
    expect(chipTexts(page)).toEqual(['全部', '魚 5', '珊瑚 6', '其他 1'])
    expect(page.findAll('[data-testid="creature-card"]')).toHaveLength(11)
  })

  // Given 我在首頁且生物卡片多到可以捲動 / When 我向下捲動
  // Then 缸別頁首與水質摘要列固定在畫面頂端，持續可見
  it('缸別頁首與水質摘要列同在一個 sticky 容器內，固定於頂端', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })
    const sticky = page.get('[data-testid="home-sticky-header"]')

    expect(sticky.classes()).toContain('sticky')
    expect(sticky.classes()).toContain('top-0')

    expect(sticky.find('[data-testid="tank-color"]').exists()).toBe(true)
    expect(sticky.find('[data-testid="tank-switch"]').exists()).toBe(true)
    expect(sticky.find('[data-testid="water-title"]').exists()).toBe(true)
  })

  // 未捲動時六項元素完整在固定區內
  it('尚未捲動時六項元素都在固定區內', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })
    const sticky = page.get('[data-testid="home-sticky-header"]')

    expect(sticky.findAll('[data-testid="water-reading"]')).toHaveLength(6)
    expect(
      sticky.findAll('[data-testid="water-reading-label"]').map(label => label.text()),
    ).toEqual(['KH', 'Ca', 'Mg', 'NO₃', 'PO₄', '鹽'])
  })

  // And 頁首收合為兩層：缸名列 + 水質單行 pill（review：固定住但沒收合，看起來只像 fixed）
  //
  // issue #55 之後讓位的節點留在 DOM 裡（才補得了間），判準改看讓位區塊的收合標記
  it('向下捲動後頁首收合：六格數字與缸副標讓位，缸名與水質狀態留著', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })

    scrollTo(1200)
    await flushPromises()

    const sticky = page.get('[data-testid="home-sticky-header"]')

    expect(isCollapsed(page)).toBe('true')
    expect(readingsSlot(page).attributes('data-collapsed')).toBe('true')
    expect(readingsSlot(page).attributes('aria-hidden')).toBe('true')
    expect(subtitleSlot(page).attributes('data-collapsed')).toBe('true')
    expect(subtitleSlot(page).attributes('aria-hidden')).toBe('true')

    // 留下的正是捲動時要隨時看得到的兩件事：我在看哪一缸、水質有沒有異常
    expect(sticky.get('h1').text()).toBe('主缸 · 4 尺')
    expect(sticky.get('[data-testid="water-attention"]').text()).toBe('2 需注意')
    expect(sticky.get('[data-testid="water-measured-at"]').text()).toBe('· 4h')
    expect(sticky.get('[data-testid="tank-switch"]').exists()).toBe(true)
  })

  // 收合會讓頁首變矮、文件跟著變短，捲動位置卡在門檻上時不能一直抖動
  it('收合之後小幅回捲不會立刻彈回展開', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })

    scrollTo(HEADER_COLLAPSE_AT)
    await flushPromises()
    expect(isCollapsed(page)).toBe('true')

    scrollTo(HEADER_COLLAPSE_AT - 1)
    await flushPromises()
    expect(isCollapsed(page)).toBe('true')

    scrollTo(HEADER_EXPAND_BELOW)
    await flushPromises()
    expect(isCollapsed(page)).toBe('false')
  })

  // 監聽器掛在共用的 window 上，頁面離開後還留著就會對著已卸載的元件寫值
  // 頁面掛著兩個 scroll 監聽：頁首收合（#55）與捲動位置的存檔（#103）。
  // 條數不是重點，「掛上去的每一個都拆掉」才是——洩漏的監聽會在下一次掛載後繼續作用
  it('離開頁面時把 scroll 監聽拆掉', async () => {
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const removeEventListener = vi.spyOn(window, 'removeEventListener')

    const page = await mountSuspended(HomePage, { route: '/' })

    const added = addEventListener.mock.calls
      .filter(([type]) => type === 'scroll')
      .map(([, handler]) => handler)

    expect(added.length).toBeGreaterThan(0)

    page.unmount()

    const removed = removeEventListener.mock.calls
      .filter(([type]) => type === 'scroll')
      .map(([, handler]) => handler)

    // 拆的必須是同一個 handler 實例：拆錯對象的話監聽照樣留在 window 上
    expect(removed).toHaveLength(added.length)
    expect(new Set(removed)).toEqual(new Set(added))

    addEventListener.mockRestore()
    removeEventListener.mockRestore()
  })

  // Given 我在首頁且生物卡片多到可以捲動 / When 我向下捲動
  // Then 「生物 N 隻」標題列與分類 chip 列隨卡片網格一起捲離畫面，不固定在頂端
  it('生物標題列與分類 chip 列留在 sticky 容器之外，跟著卡片一起捲走', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })
    const sticky = page.get('[data-testid="home-sticky-header"]')

    expect(sticky.find('[data-testid="creature-total"]').exists()).toBe(false)
    expect(sticky.find('[data-testid="creature-chip"]').exists()).toBe(false)
    expect(sticky.find('[data-testid="creature-card"]').exists()).toBe(false)

    // 留在容器外，但仍在頁面上——不是被拿掉了
    expect(page.get('[data-testid="creature-total"]').text()).toBe('12 隻')
    expect(page.findAll('[data-testid="creature-chip"]')).toHaveLength(4)

    // 收合之後也一樣：它們是跟著卡片捲走的，不會被收進固定區
    scrollTo(1200)
    await flushPromises()

    expect(page.get('[data-testid="home-sticky-header"]').find('[data-testid="creature-chip"]').exists()).toBe(false)
    expect(page.findAll('[data-testid="creature-chip"]')).toHaveLength(4)
  })

  // Given 我向下捲動，生物卡片正從固定的頁首下方通過 / When 我觀察兩者交界
  // Then 卡片被頁首遮住而不是蓋在頁首上（頁首在上層）
  // And 頁首底部有分隔線與 backdrop blur，可看出它浮在內容之上
  it('頁首在卡片上層，且有底部分隔線、不透光背景與 backdrop blur', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })
    const classes = page.get('[data-testid="home-sticky-header"]').classes()

    // 卡片沒有自己的堆疊層級，頁首只要有正的 z 就會蓋在它上面
    expect(zIndexOf(classes)).toBeGreaterThan(0)
    expect(classes).toContain('border-b')
    expect(classes).toContain('backdrop-blur')
    expect(classes.some(name => name.startsWith('bg-'))).toBe(true)
  })

  // Given 我向下捲動後再向上捲回頂端 / When 捲動位置回到 0
  // Then 版面回到初始樣態，與「尚未捲動」時一致
  it('捲下去再捲回來，DOM 回到初始樣態', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })

    // 首幀的「不要動」旗標本身就是 DOM 的一部分，等它解除再取快照，
    // 不然比到的差異是旗標而不是版面
    await afterFirstFrame(page)

    const atTop = page.html()

    scrollTo(1200)
    await flushPromises()

    // 收合是實際的樣態變化，捲動中的 DOM 本來就該與頂端時不同
    expect(page.html()).not.toBe(atTop)

    scrollTo(0)
    await flushPromises()

    expect(page.html()).toBe(atTop)
    expect(page.findAll('[data-testid="water-reading"]')).toHaveLength(6)
    expect(page.get('[data-testid="tank-subtitle"]').text()).toBe('SPS MIXED · 420L')
  })

  // Given 該缸尚無任何水質記錄 / When 我向下捲動
  // Then 頁首與水質摘要列照常固定在頂端，水質摘要列維持空狀態內容，不顯示需注意徽章
  it('沒有水質記錄時，收合後固定區內仍有頁首與水質摘要列的空狀態', async () => {
    state.home = { 'tank-1': { water: null, creatures: MAIN_TANK_CREATURES } }

    const page = await mountSuspended(HomePage, { route: '/' })

    scrollTo(1200)
    await flushPromises()

    const sticky = page.get('[data-testid="home-sticky-header"]')

    expect(sticky.classes()).toContain('sticky')
    expect(isCollapsed(page)).toBe('true')
    expect(sticky.find('[data-testid="tank-color"]').exists()).toBe(true)
    expect(sticky.get('[data-testid="water-empty"]').text()).toContain('還沒有水質記錄')
    expect(sticky.get('[data-testid="water-empty-action"]').text()).toBe('記錄水質')
    expect(sticky.find('[data-testid="water-attention"]').exists()).toBe(false)
  })

  // Given 固定的頁首與底部 tab 列同時在畫面上 / When 我捲動頁面
  // Then 底部 tab 列位置與外觀不變，且不被固定的頁首覆蓋
  it('sticky 頁首的層級低於底部 tab 列', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })
    const bar = await mountSuspended(BottomTabBar, { route: '/' })

    const header = zIndexOf(page.get('[data-testid="home-sticky-header"]').classes())
    const tabBar = zIndexOf(bar.get('nav').classes())

    expect(header).toBeLessThan(tabBar)
  })

  // Given 頁首已固定在頂端 / When 我點開切換缸的下拉選單
  // Then 選單完整顯示在生物卡片之上，不被卡片蓋住、不被 sticky 區裁切
  it('收合狀態下切換缸的選單仍在 sticky 容器內展開，且容器不裁切溢出內容', async () => {
    state.tanks = [MAIN_TANK, SECOND_TANK]

    const page = await mountSuspended(HomePage, { route: '/' })

    scrollTo(1200)
    await flushPromises()

    const sticky = page.get('[data-testid="home-sticky-header"]')

    await page.get('[data-testid="tank-switch"]').trigger('click')

    // 選單比固定區高，容器一旦裁切溢出內容就會被切掉半截
    expect(sticky.find('[data-testid="tank-menu"]').exists()).toBe(true)
    expect(sticky.classes()).not.toContain('overflow-hidden')
    expect(sticky.classes().some(name => name.startsWith('overflow-'))).toBe(false)
    expect(sticky.get('[data-testid="tank-menu"]').findAll('[role="option"]')).toHaveLength(2)
  })

  // 空狀態沒有頁首與水質列，套上 sticky 容器只會固定住一片空白
  it('尚未建立任何缸時不套用 sticky 容器', async () => {
    state.tanks = []

    const page = await mountSuspended(HomePage, { route: '/' })

    expect(page.get('[data-testid="tank-empty"]').exists()).toBe(true)
    expect(page.find('[data-testid="home-sticky-header"]').exists()).toBe(false)
  })

  // 容器留外距的話，捲動的卡片會從縫隙穿過去，blur 就破了——間距必須給在容器內部
  it('固定區本身不留外距，間距給在容器內部', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })
    const classes = page.get('[data-testid="home-sticky-header"]').classes()

    expect(classes.some(name => /^-?m[trblxy]?-/.test(name))).toBe(false)
    expect(classes.some(name => name.startsWith('pb-'))).toBe(true)
    // 瀏海機型：頁首貼到頂端後需要安全區域的上內距
    expect(classes).toContain('pt-[env(safe-area-inset-top)]')
  })
})

// issue #55：收合／展開要看得出「同一塊東西變小了」，而不是「換了一塊畫面」。
// 過場本身（時間、緩動曲線）驗不到，這裡驗的是讓它成立的三個前提：
// 節點留在 DOM、狀態只靠 class 翻轉、首幀不補播。
describe('首頁 — 收合過場', () => {
  // Given 我重新整理頁面，而瀏覽器還原到一個已經超過門檻的捲動位置
  // When 畫面首次渲染 / Then 頁首直接以收合樣態出現，不會先展開再播一次收合動畫
  it('還原到已捲動的位置時，首幀直接是收合樣態且不播過場', async () => {
    setScrollY(1200)

    const page = await mountSuspended(HomePage, { route: '/' })
    const sticky = page.get('[data-testid="home-sticky-header"]')

    expect(isCollapsed(page)).toBe('true')
    expect(readingsSlot(page).attributes('data-collapsed')).toBe('true')

    // 首幀掛著停用過場的旗標，「展開 → 收合」那一段就不會演給人看
    expect(sticky.attributes('data-animated')).toBe('false')
    expect(sticky.classes()).toContain('reef-motion-off')
  })

  it('首幀過後才開放過場', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })

    expect(page.get('[data-testid="home-sticky-header"]').attributes('data-animated')).toBe('false')

    await afterFirstFrame(page)

    expect(page.get('[data-testid="home-sticky-header"]').classes()).not.toContain('reef-motion-off')
  })

  // Given 頁首已收合 / When 我向上捲回頂端、頁首展開
  // Then 展開同樣有過場，方向與收合對稱 / And 展開完成後的樣態與「尚未捲動」時一致
  it('展開與收合對稱：兩個讓位區塊一起翻轉，翻回來與尚未捲動時一致', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })
    await afterFirstFrame(page)

    const expanded = [readingsSlot(page).classes(), subtitleSlot(page).classes()]

    scrollTo(1200)
    await flushPromises()

    expect(readingsSlot(page).classes()).toContain('grid-rows-[0fr]')
    expect(subtitleSlot(page).classes()).toContain('grid-rows-[0fr]')

    scrollTo(0)
    await flushPromises()

    expect(readingsSlot(page).classes()).toEqual(expanded[0])
    expect(subtitleSlot(page).classes()).toEqual(expanded[1])
    expect(readingsSlot(page).attributes('aria-hidden')).toBeUndefined()
    expect(subtitleSlot(page).attributes('aria-hidden')).toBeUndefined()
  })

  // Given 我持續快速捲動、經過門檻多次 / When 前一次過場尚未播完就再次翻轉
  // Then 頁首不會卡在中間狀態，最終樣態與當下的捲動位置一致
  it('連續快速翻轉門檻後，最終樣態跟著當下的捲動位置', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })
    await afterFirstFrame(page)

    for (const offset of [1200, 0, 900, 0, 600]) {
      scrollTo(offset)
    }
    await flushPromises()

    expect(isCollapsed(page)).toBe('true')
    expect(readingsSlot(page).attributes('data-collapsed')).toBe('true')
    expect(subtitleSlot(page).attributes('data-collapsed')).toBe('true')

    scrollTo(0)
    await flushPromises()

    expect(isCollapsed(page)).toBe('false')
    expect(readingsSlot(page).attributes('data-collapsed')).toBe('false')
    expect(subtitleSlot(page).attributes('data-collapsed')).toBe('false')
  })

  // 過場只在狀態翻轉時發生（class 切換）。動畫一旦綁進 scroll handler，
  // 每一次捲動都得重算，中階手機上會直接掉幀——也是「卡在中間狀態」的來源
  it('捲動時不寫 inline style，樣態全靠 class 翻轉', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })
    await afterFirstFrame(page)

    for (const offset of [1200, 0, 900, 30]) {
      scrollTo(offset)
    }
    await flushPromises()

    expect(readingsSlot(page).attributes('style')).toBeUndefined()
    expect(subtitleSlot(page).attributes('style')).toBeUndefined()
    expect(page.get('[data-testid="home-sticky-header"]').attributes('style')).toBeUndefined()
  })

  // Given 頁首正在播放過場 / When 我觀察畫面其他部分 / Then 底部 tab 列不移動
  it('底部 tab 列是 fixed，頁首變矮不會把它一起拉上來', async () => {
    const bar = await mountSuspended(BottomTabBar, { route: '/' })
    const classes = bar.get('nav').classes()

    expect(classes).toContain('fixed')
    expect(classes).toContain('bottom-0')
  })
})

// issue #103：SPA（#84）下瀏覽器的捲動位置還原永遠落空——`load` 當下文件只有一個
// viewport 高，等資料到齊、文件變長時瀏覽器不會再回頭補。還原改由頁面自己做，
// 而 #55 的 animated 旗標本來就是為這一刻寫的：補回去的那一次不能演一遍收合。
//
// requestAnimationFrame 換成手動推進：這幾題驗的正是先後順序（還原 → 開放過場），
// 交給真實時鐘的話，「還原當下過場還沒開放」會退化成一條靠 sleep 賭運氣的斷言。
describe('首頁 — 捲動位置還原', () => {
  let frames: FrameRequestCallback[] = []

  /** 推進 n 幀：每一幀把目前排隊的 callback 全部執行掉 */
  async function runFrames(count = 1) {
    for (let index = 0; index < count; index++) {
      const pending = frames

      frames = []

      for (const callback of pending) {
        callback(index)
      }

      await flushPromises()
    }
  }

  /** 內容到齊、文件長到這麼高——還原的時機看的是這個值 */
  function setDocumentHeight(height: number) {
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: height,
      configurable: true,
    })
  }

  /** 上一份文件（重新整理前）留下的存檔 */
  function markFromPreviousDocument(top: number) {
    window.sessionStorage.setItem(
      scrollRestoreKey('/'),
      serializeScrollMark({ top, document: 'previous-document' }),
    )
  }

  function sticky(page: Awaited<ReturnType<typeof mountSuspended>>) {
    return page.get('[data-testid="home-sticky-header"]')
  }

  beforeEach(() => {
    frames = []
    window.sessionStorage.clear()

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)

      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})

    // happy-dom 的 scrollTo 不會動到 scrollY，補上瀏覽器的那一半
    vi.stubGlobal('scrollTo', (options: ScrollToOptions) => {
      scrollTo(options.top ?? 0)
    })

    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true })

    // 進站當下：資料還在路上，文件只有一個 viewport 高
    setDocumentHeight(844)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Given 我在首頁向下捲動到頁首已經收合的位置 / When 我重新整理頁面
  // Then 內容到齊之後，捲動位置回到重新整理前的位置，頁首呈收合樣態
  it('內容到齊之後捲動位置回到原處，頁首呈收合樣態', async () => {
    markFromPreviousDocument(1200)

    const page = await mountSuspended(HomePage, { route: '/' })

    // 文件還只有一個 viewport 高，這時候捲過去只會被夾回頂端
    await runFrames(3)

    expect(window.scrollY).toBe(0)
    // 還沒捲，但頁首已經先擺成還原後的樣態——那一捲之後才收合的話，
    // 抽掉的高度會被 scroll anchoring 從落點上扣回來（見下方那條 test）
    expect(isCollapsed(page)).toBe('true')

    setDocumentHeight(3000)
    await runFrames(2)

    expect(window.scrollY).toBe(1200)
    expect(isCollapsed(page)).toBe('true')
  })

  // Given 上述的捲動位置還原正在發生 / When 畫面首次以還原後的位置渲染
  // Then 頁首直接以收合樣態出現，不會先展開再播一次收合動畫（issue #55 的既有條件）
  it('還原的那一次不補播收合動畫，之後才開放過場', async () => {
    markFromPreviousDocument(1200)

    const page = await mountSuspended(HomePage, { route: '/' })

    // 還原還沒發生：過場在這段期間不能開放，否則補回去的那一下會演一次收合
    await runFrames(3)

    expect(sticky(page).attributes('data-animated')).toBe('false')

    setDocumentHeight(3000)
    await runFrames(2)

    expect(isCollapsed(page)).toBe('true')
    expect(sticky(page).attributes('data-animated')).toBe('false')
    expect(sticky(page).classes()).toContain('reef-motion-off')

    // 落地之後才開放，之後真正由捲動觸發的翻轉照樣有過場
    await runFrames(2)

    expect(sticky(page).attributes('data-animated')).toBe('true')
    expect(sticky(page).classes()).not.toContain('reef-motion-off')
  })

  // 順序不能反過來：先捲過去、再讓頁首收合的話，收合會把文件上方抽掉約 108px，
  // 瀏覽器的 scroll anchoring 為了讓眼前的內容不跳動，會把 scrollY 往回推同樣的距離——
  // 補回去的位置就永遠差那 108px（PR #105 的 E2E 在 preview 上量到的：
  // 目標 1171、落點 1063，而收合把頁首從 215 縮到 107）。
  //
  // 所以還原期間頁首的樣態要由「等一下要補回去的位置」決定，而不是由當下的
  // scrollY（那時還在頂端）。捲過去的那一刻上方高度已經定案，就沒有東西可以推它。
  it('捲過去之前頁首就先擺成收合樣態，落點才不會被收合推走', async () => {
    markFromPreviousDocument(1200)

    const page = await mountSuspended(HomePage, { route: '/' })

    await runFrames(3)

    // 還沒捲，但頁首已經是最終樣態了
    expect(window.scrollY).toBe(0)
    expect(isCollapsed(page)).toBe('true')
    // 這段期間過場仍未開放，所以「先擺成收合」不會被看成一段動畫
    expect(sticky(page).attributes('data-animated')).toBe('false')
  })

  // 先擺成收合是為了還原；還原沒發生就要擺回去，否則頁首會停在
  // 「收合樣態、人卻在頂端」的錯位狀態
  it('等不到內容而放棄時，頁首回到展開樣態', async () => {
    markFromPreviousDocument(1200)

    const page = await mountSuspended(HomePage, { route: '/' })

    await runFrames(SCROLL_RESTORE_MAX_FRAMES + 2)

    expect(window.scrollY).toBe(0)
    expect(isCollapsed(page)).toBe('false')
    expect(sticky(page).attributes('data-animated')).toBe('true')
  })

  // Given 我在首頁頂端（未捲動）/ When 我重新整理頁面
  // Then 畫面停在頂端，頁首呈展開樣態，不會被還原到別的位置
  it('在頂端重新整理時停在頂端，頁首展開且過場照常開放', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })

    setDocumentHeight(3000)
    await runFrames(3)

    expect(window.scrollY).toBe(0)
    expect(isCollapsed(page)).toBe('false')
    // 沒有東西要等，過場不該被還原機制拖住
    expect(sticky(page).attributes('data-animated')).toBe('true')
  })

  // 存哪裡是實作細節，但「不要存進 URL」不是——網址是使用者會複製、會分享的東西
  it('捲動位置存在 sessionStorage，不寫進網址', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })

    setDocumentHeight(3000)
    await runFrames(2)
    scrollTo(1200)
    await flushPromises()

    expect(window.sessionStorage.getItem(scrollRestoreKey('/'))).toContain('1200')
    expect(page.vm.$route.fullPath).toBe('/')
  })
})

describe('首頁 — 尚未建立任何缸', () => {
  it('沒有任何未封存的缸時顯示空狀態，而不是壞掉的頁首', async () => {
    state.tanks = []

    const page = await mountSuspended(HomePage, { route: '/' })

    expect(page.get('[data-testid="tank-empty"]').exists()).toBe(true)
    expect(page.find('[data-testid="tank-switch"]').exists()).toBe(false)
  })

  // Given 我是一個還沒有任何缸的使用者 / When 我開啟首頁
  // Then 空狀態除了說明文字之外，顯示一個「建立第一個缸」的主要行動按鈕
  it('空狀態除了說明文字，還有「建立第一個缸」的行動按鈕', async () => {
    state.tanks = []

    const page = await mountSuspended(HomePage, { route: '/' })
    const empty = page.get('[data-testid="tank-empty"]')

    expect(empty.text()).toContain('還沒有任何缸')
    // 設計稿的說明文字說的是「建立之後能做什麼」，不是「建立之後會怎樣」
    expect(empty.text()).toContain('記錄水質')
    expect(page.get('[data-testid="tank-empty-action"]').text()).toContain('建立我的第一個缸')
  })

  // 設計稿的空狀態下方有三格預覽：水質趨勢 / 生物庫存 / 保養提醒。
  // 還沒有缸時它們沒有東西可看，所以只呈現不可點的預告。
  it('空狀態下方預告三項功能，且都不可點', async () => {
    state.tanks = []

    const page = await mountSuspended(HomePage, { route: '/' })
    const tiles = page.findAll('[data-testid="tank-empty-preview"]')

    expect(tiles.map(tile => tile.text())).toEqual(['水質趨勢', '生物庫存', '保養提醒'])
    expect(tiles.every(tile => tile.attributes('disabled') !== undefined)).toBe(true)
    expect(tiles.every(tile => tile.element.tagName === 'BUTTON')).toBe(true)

    // 唯一的出口是「建立我的第一個缸」
    expect(page.get('[data-testid="tank-empty"]').findAll('a')).toHaveLength(1)
  })

  // Given 我在首頁的空狀態 / When 我點擊「建立第一個缸」/ Then 導向建立缸的表單
  it('「建立第一個缸」連向建立缸的表單', async () => {
    state.tanks = []

    const page = await mountSuspended(HomePage, { route: '/' })

    expect(page.get('[data-testid="tank-empty-action"]').attributes('href')).toBe('/tanks/new')
  })
})

describe('首頁 — 從建立缸的表單導回', () => {
  // And 導回首頁，該缸成為當前缸，水質摘要列與生物列表都顯示各自的空狀態
  it('網址帶著 ?tank=<id> 時，該缸就是當前缸', async () => {
    state.tanks = [MAIN_TANK, SECOND_TANK]
    state.home = { 'tank-1': MAIN_TANK_HOME, 'tank-2': { water: null, creatures: [] } }

    const page = await mountSuspended(HomePage, { route: '/?tank=tank-2' })

    expect(page.get('h1').text()).toBe('軟體缸 · 2 尺')
    expect(page.get('[data-testid="water-empty"]').exists()).toBe(true)
    expect(page.get('[data-testid="creature-empty"]').exists()).toBe(true)
    expect(page.get('[data-testid="creature-total"]').text()).toBe('0 隻')
  })

  // 剛建立的第一個缸：displayOrder 為 0，清單裡就它一個
  it('剛建立的缸還沒有任何資料時，水質與生物都顯示空狀態', async () => {
    state.tanks = [MAIN_TANK]
    state.home = { 'tank-1': { water: null, creatures: [] } }

    const page = await mountSuspended(HomePage, { route: '/?tank=tank-1' })

    expect(page.get('h1').text()).toBe('主缸 · 4 尺')
    expect(page.get('[data-testid="water-empty"]').exists()).toBe(true)
    expect(page.get('[data-testid="creature-empty"]').exists()).toBe(true)
  })

  // 網址上的 tank 不在清單裡（缸被封存 / 換了裝置）時不能整頁壞掉，退回預設缸
  it('?tank=<id> 指到不存在的缸時退回預設缸', async () => {
    state.tanks = [MAIN_TANK, SECOND_TANK]

    const page = await mountSuspended(HomePage, { route: '/?tank=tank-404' })

    expect(page.get('h1').text()).toBe('主缸 · 4 尺')
  })
})
