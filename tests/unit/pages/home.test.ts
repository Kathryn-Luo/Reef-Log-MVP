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
  // issue #132：兩支請求各自可以被打成 500，用來分辨「拿不到資料」與「你沒有資料」
  failTanks: false,
  failHome: false,
  // issue #144：/api/guest-sandbox 的回答決定「空清單」是準備中還是真的沒有缸
  sandboxAlreadySeeded: true,
  failSandbox: false,
  /** 打了幾次。冪等由伺服器負責，但首頁不該一直重打——那條防線在這裡 */
  sandboxCalls: 0,
  /** 別人（另一個分頁）先複製完了：資料在，但這一次呼叫回的是 alreadySeeded: true */
  sandboxFilledByOther: false,
}

/** 說不出原因的失敗（500 / 離線 / function 掛掉），沒有可以直接顯示給使用者的訊息 */
function serverError() {
  return createError({ statusCode: 500, statusMessage: 'Internal Server Error' })
}

// 首頁要登入才進得去（#67 的全域路由保護）。少了這張 session，mountSuspended
// 的導覽會先被導去 /login，頁面就讀不到網址上的 ?tank=<id>。
mockNuxtImport('useUserSession', () => () => signedInUserSession())

// 訪客沙盒的補建（issue #144）。首頁只在缸清單是空的時候才打這一支——那是
// 「沙盒還在複製」與「這個帳號真的沒有缸」唯一分不開的時刻。
//
// 預設 alreadySeeded: true ＝「沒有欠著的沙盒」，也就是既有那些空狀態測試要的前提：
// 清單空著就是真的沒有缸。訪客那條路徑由下面 issue #144 的 describe 自己改成 false。
registerEndpoint('/api/guest-sandbox', {
  method: 'POST',
  handler: () => {
    state.sandboxCalls++

    if (state.failSandbox) {
      throw serverError()
    }

    // 複製完成 ＝ 從這一刻起缸清單就有東西了，與伺服器上真的發生的事一致。
    // sandboxFilledByOther 模擬「別人先複製完了」：資料進來了，但這一次呼叫
    // 什麼都沒做（冪等鎖被另一個分頁搶走），所以回的是 alreadySeeded: true
    if (!state.sandboxAlreadySeeded || state.sandboxFilledByOther) {
      state.tanks = [MAIN_TANK]
    }

    return { copied: state.sandboxAlreadySeeded ? 0 : 1, alreadySeeded: state.sandboxAlreadySeeded }
  },
})

registerEndpoint('/api/tanks', () => {
  if (state.failTanks) {
    throw serverError()
  }

  return { tanks: state.tanks }
})
registerEndpoint('/api/tanks/tank-1/home', () => {
  if (state.failHome) {
    throw serverError()
  }

  return state.home['tank-1'] ?? { water: null, creatures: [] }
})
registerEndpoint('/api/tanks/tank-2/home', () => {
  if (state.failHome) {
    throw serverError()
  }

  return state.home['tank-2'] ?? { water: null, creatures: [] }
})

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
  state.failTanks = false
  state.failHome = false
  state.sandboxAlreadySeeded = true
  state.failSandbox = false
  state.sandboxCalls = 0
  state.sandboxFilledByOther = false
})

/**
 * 掛載首頁並等資料到齊。
 *
 * issue #110 之前首頁的 useAsyncData 是 `await` 的，Suspense 會擋到資料回來才渲染，
 * 所以 `mountSuspended()` 回來時畫面已經是最終樣子。改成 lazy 之後（那個 await 正是
 * 「進站後一片空白」的成因）掛載當下畫面是骨架，於是這裡要自己多等一拍。
 *
 * 需要看骨架本身的那幾題不走這個 helper，直接用 mountSuspended。
 */
async function mountHome(route = '/') {
  const page = await mountSuspended(HomePage, { route })

  // 一次 flush 不夠：缸清單與該缸的內容是**串起來**的兩支請求（#110 把它們併成同一個
  // useAsyncData，才不會在中間閃一次空狀態），所以第二支要等第一支落地後才發得出去。
  // 等到骨架真的消失為止，而不是憑感覺數幾次——請求鏈之後變長時這裡不必跟著改。
  // 缸清單空著時還要多等一段：首頁會去問 /api/guest-sandbox「這是準備中還是真的沒有缸」
  // （issue #144），在答案回來之前畫面停在「正在準備示範資料」上。
  const settling = () => page.find('[data-testid="home-loading"]').exists()
    || page.find('[data-testid="home-preparing"]').exists()

  for (let attempt = 0; attempt < 10 && settling(); attempt++) {
    await flushPromises()
  }

  // 迴圈耗盡就明確失敗。少了這一句，卡住的頁面會被靜靜交出去——
  // 而所有「斷言某東西**不存在**」的測試都會空過：一頁骨架同樣沒有 /tanks/new、
  // 同樣不含「還沒有任何缸」。
  expect(settling(), '頁面十次 flush 之後仍停在骨架或準備中').toBe(false)

  return page
}

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
    const page = await mountHome()

    expect(page.get('h1').text()).toBe('主缸 · 4 尺')
    expect(page.get('[data-testid="tank-subtitle"]').text()).toBe('SPS MIXED · 420L')
    expect(page.get('[data-testid="tank-color"]').attributes('data-color')).toBe('#2dd4bf')
    expect(page.get('[data-testid="tank-switch"]').exists()).toBe(true)
  })

  // Given 我有兩個以上未封存的缸 / When 我點擊缸名旁的 ∨ / Then 出現缸切換選單
  // When 我選擇另一個缸 / Then 首頁的水質摘要與生物列表改為顯示該缸的資料
  it('切換缸之後水質摘要與生物列表改看該缸的資料', async () => {
    state.tanks = [MAIN_TANK, SECOND_TANK]

    const page = await mountHome()

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
    const page = await mountHome()

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

    const page = await mountHome()

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
    const page = await mountHome()

    // 一開始是收合的，畫面上沒有儀表板
    expect(page.find('[data-testid="water-dashboard"]').exists()).toBe(false)

    await openDashboard(page)

    expect(page.get('[data-testid="water-dashboard-title"]').text()).toBe('數據儀表板')
    expect(page.get('[data-testid="water-dashboard-subtitle"]').text()).toBe('主缸 · 更新於 4 小時前')
  })

  // Then 依序列出 KH / Ca / Mg / NO₃ / PO₄ / 鹽度六列
  it('六列測項連同數值、單位、狀態與區間一起出現', async () => {
    const page = await mountHome()
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
    const page = await mountHome()
    await openDashboard(page)

    expect(page.get('[data-testid="water-dashboard-backdrop"]').exists()).toBe(true)

    // 首頁沒有被換掉：頁首、摘要列與生物卡片都還在
    expect(page.get('h1').text()).toBe('主缸 · 4 尺')
    expect(page.get('[data-testid="water-attention"]').text()).toBe('2 需注意')
    expect(page.findAll('[data-testid="creature-card"]')).toHaveLength(11)
  })

  // Given 儀表板已展開 / When 我點擊右上角 ✕ / Then bottom sheet 收合，回到首頁預設狀態
  it('點擊 ✕ 後收合，回到首頁預設狀態', async () => {
    const page = await mountHome()
    await openDashboard(page)

    await page.get('[data-testid="water-dashboard-close"]').trigger('click')
    await flushPromises()

    expect(page.find('[data-testid="water-dashboard"]').exists()).toBe(false)
    expect(page.get('[data-testid="water-summary-row"]').exists()).toBe(true)
    expect(page.findAll('[data-testid="water-reading"]')).toHaveLength(6)
  })

  // When 我點擊背景遮罩 / Then bottom sheet 收合
  it('點擊背景遮罩後收合', async () => {
    const page = await mountHome()
    await openDashboard(page)

    await page.get('[data-testid="water-dashboard-backdrop"]').trigger('click')
    await flushPromises()

    expect(page.find('[data-testid="water-dashboard"]').exists()).toBe(false)
  })

  // When 我向下拖曳把手 / Then bottom sheet 收合
  it('向下拖曳把手後收合', async () => {
    const page = await mountHome()
    await openDashboard(page)

    await page.get('[data-testid="water-dashboard-handle"]').trigger('pointerdown', { clientY: 100 })
    await page.get('[data-testid="water-dashboard"]').trigger('pointermove', { clientY: 220 })
    await page.get('[data-testid="water-dashboard"]').trigger('pointerup', { clientY: 220 })
    await flushPromises()

    expect(page.find('[data-testid="water-dashboard"]').exists()).toBe(false)
  })

  // When 我點擊底部的「＋ 記錄水質」主要按鈕 / Then bottom sheet 關閉並導向「記錄水質」頁面
  it('「＋ 記錄水質」連向 /log，點下去同時收合儀表板', async () => {
    const page = await mountHome()
    await openDashboard(page)

    const action = page.get('[data-testid="water-dashboard-log"]')
    expect(action.attributes('href')).toBe('/log')

    await action.trigger('click')
    await flushPromises()

    expect(page.find('[data-testid="water-dashboard"]').exists()).toBe(false)
  })

  // 頁面捲下去、摘要列收合成單行 pill 之後，它仍然是同一個入口
  it('頁首收合狀態下點摘要列一樣展開儀表板', async () => {
    const page = await mountHome()

    scrollTo(1200)
    await flushPromises()
    expect(isCollapsed(page)).toBe('true')

    await openDashboard(page)

    expect(page.get('[data-testid="water-dashboard-title"]').text()).toBe('數據儀表板')
  })

  // Given 該缸尚無任何水質記錄：沒有東西可攤開，摘要列維持它自己的空狀態入口
  it('沒有水質記錄的缸點摘要列不會展開儀表板', async () => {
    state.home = { 'tank-1': { water: null, creatures: MAIN_TANK_CREATURES } }

    const page = await mountHome()

    await openDashboard(page)

    expect(page.find('[data-testid="water-dashboard"]').exists()).toBe(false)
    expect(page.get('[data-testid="water-empty-action"]').attributes('href')).toBe('/log')
  })
})

describe('首頁 — 生物區', () => {
  // Then 「生物」標題右側顯示「12 隻」，並有 4 個分類 chip：全部 / 魚 5 / 珊瑚 6 / 其他 1
  it('顯示總隻數與四個分類 chip', async () => {
    const page = await mountHome()

    expect(page.get('[data-testid="creature-total"]').text()).toBe('12 隻')
    expect(chipTexts(page)).toEqual(['全部', '魚 5', '珊瑚 6', '其他 1'])
  })

  it('預設選中「全部」，同名的公子小丑合併為一張 ×2 卡片', async () => {
    const page = await mountHome()

    const chips = page.findAll('[data-testid="creature-chip"]')
    expect(chips.map(chip => chip.attributes('aria-pressed'))).toEqual(['true', 'false', 'false', 'false'])

    // 12 隻扣掉合併掉的那一隻公子小丑 = 11 張卡片
    const titles = page.findAll('[data-testid="creature-title"]').map(title => title.text())
    expect(titles).toHaveLength(11)
    expect(titles).toContain('公子小丑 ×2')
  })

  // When 我點擊「魚 5」/ Then 卡片網格只顯示 category 為 FISH 的生物，該 chip 呈選中態
  it('點擊「魚 5」後只顯示魚，且該 chip 呈選中態', async () => {
    const page = await mountHome()

    await page.findAll('[data-testid="creature-chip"]')[1]!.trigger('click')

    const chips = page.findAll('[data-testid="creature-chip"]')
    expect(chips.map(chip => chip.attributes('aria-pressed'))).toEqual(['false', 'true', 'false', 'false'])

    const titles = page.findAll('[data-testid="creature-title"]').map(title => title.text())
    expect(titles).toEqual(['藍倒吊', '黃三角', '公子小丑 ×2', '六線龍'])
    expect(page.findAll('[data-testid="creature-category"]').every(label => label.text() === '魚')).toBe(true)
  })

  it('點擊「珊瑚 6」後只顯示珊瑚', async () => {
    const page = await mountHome()

    await page.findAll('[data-testid="creature-chip"]')[2]!.trigger('click')

    expect(page.findAll('[data-testid="creature-card"]')).toHaveLength(6)
    expect(page.findAll('[data-testid="creature-category"]').every(label => label.text() === '珊瑚')).toBe(true)
  })

  // Given 我在首頁 / When 我點擊任一張生物卡片 / Then 導向該生物的「生物詳情」頁
  it('每張卡片都連向該生物的詳情頁', async () => {
    const page = await mountHome()
    const first = page.findAll('[data-testid="creature-card"]')[0]!

    expect(first.get('a').attributes('href')).toBe('/creatures/f1')
  })

  it('沒有任何生物時顯示空狀態', async () => {
    state.home = { 'tank-1': { water: null, creatures: [] } }

    const page = await mountHome()

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
    const page = await mountHome()

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
    const page = await mountHome()
    const sticky = page.get('[data-testid="home-sticky-header"]')

    expect(sticky.classes()).toContain('sticky')
    expect(sticky.classes()).toContain('top-0')

    expect(sticky.find('[data-testid="tank-color"]').exists()).toBe(true)
    expect(sticky.find('[data-testid="tank-switch"]').exists()).toBe(true)
    expect(sticky.find('[data-testid="water-title"]').exists()).toBe(true)
  })

  // 未捲動時六項元素完整在固定區內
  it('尚未捲動時六項元素都在固定區內', async () => {
    const page = await mountHome()
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
    const page = await mountHome()

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
    const page = await mountHome()

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

    const page = await mountHome()

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
    const page = await mountHome()
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
    const page = await mountHome()
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
    const page = await mountHome()

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

    const page = await mountHome()

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
    const page = await mountHome()
    const bar = await mountSuspended(BottomTabBar, { route: '/' })

    const header = zIndexOf(page.get('[data-testid="home-sticky-header"]').classes())
    const tabBar = zIndexOf(bar.get('nav').classes())

    expect(header).toBeLessThan(tabBar)
  })

  // Given 頁首已固定在頂端 / When 我點開切換缸的下拉選單
  // Then 選單完整顯示在生物卡片之上，不被卡片蓋住、不被 sticky 區裁切
  it('收合狀態下切換缸的選單仍在 sticky 容器內展開，且容器不裁切溢出內容', async () => {
    state.tanks = [MAIN_TANK, SECOND_TANK]

    const page = await mountHome()

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

    const page = await mountHome()

    expect(page.get('[data-testid="tank-empty"]').exists()).toBe(true)
    expect(page.find('[data-testid="home-sticky-header"]').exists()).toBe(false)
  })

  // 容器留外距的話，捲動的卡片會從縫隙穿過去，blur 就破了——間距必須給在容器內部
  it('固定區本身不留外距，間距給在容器內部', async () => {
    const page = await mountHome()
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

    const page = await mountHome()
    const sticky = page.get('[data-testid="home-sticky-header"]')

    expect(isCollapsed(page)).toBe('true')
    expect(readingsSlot(page).attributes('data-collapsed')).toBe('true')

    // 首幀掛著停用過場的旗標，「展開 → 收合」那一段就不會演給人看
    expect(sticky.attributes('data-animated')).toBe('false')
    expect(sticky.classes()).toContain('reef-motion-off')
  })

  it('首幀過後才開放過場', async () => {
    const page = await mountHome()

    expect(page.get('[data-testid="home-sticky-header"]').attributes('data-animated')).toBe('false')

    await afterFirstFrame(page)

    expect(page.get('[data-testid="home-sticky-header"]').classes()).not.toContain('reef-motion-off')
  })

  // Given 頁首已收合 / When 我向上捲回頂端、頁首展開
  // Then 展開同樣有過場，方向與收合對稱 / And 展開完成後的樣態與「尚未捲動」時一致
  it('展開與收合對稱：兩個讓位區塊一起翻轉，翻回來與尚未捲動時一致', async () => {
    const page = await mountHome()
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
    const page = await mountHome()
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
    const page = await mountHome()
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

    const page = await mountHome()

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

    const page = await mountHome()

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

    const page = await mountHome()

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

    const page = await mountHome()

    await runFrames(SCROLL_RESTORE_MAX_FRAMES + 2)

    expect(window.scrollY).toBe(0)
    expect(isCollapsed(page)).toBe('false')
    expect(sticky(page).attributes('data-animated')).toBe('true')
  })

  // Given 我在首頁頂端（未捲動）/ When 我重新整理頁面
  // Then 畫面停在頂端，頁首呈展開樣態，不會被還原到別的位置
  it('在頂端重新整理時停在頂端，頁首展開且過場照常開放', async () => {
    const page = await mountHome()

    setDocumentHeight(3000)
    await runFrames(3)

    expect(window.scrollY).toBe(0)
    expect(isCollapsed(page)).toBe('false')
    // 沒有東西要等，過場不該被還原機制拖住
    expect(sticky(page).attributes('data-animated')).toBe('true')
  })

  // 存哪裡是實作細節，但「不要存進 URL」不是——網址是使用者會複製、會分享的東西
  it('捲動位置存在 sessionStorage，不寫進網址', async () => {
    const page = await mountHome()

    setDocumentHeight(3000)
    await runFrames(2)
    scrollTo(1200)
    await flushPromises()

    expect(window.sessionStorage.getItem(scrollRestoreKey('/'))).toContain('1200')
    expect(page.vm.$route.fullPath).toBe('/')
  })
})

// issue #132：請求失敗時 useAsyncData 的 data 是 null，而畫面只分「載入中」與
// 「載入完」兩態，於是一律落到空狀態——「拿不到資料」被講成「你沒有資料」。
// 最糟的一條路徑是照著空狀態按下去，多一個其實不需要的缸。
describe('首頁 — 取資料失敗', () => {
  // Given 我有一個缸 / When 我進入首頁而 API 回 500
  // Then 畫面顯示「載入失敗」與重試的入口，不是空狀態
  it('缸清單回 500 時顯示載入失敗與重試，而不是空狀態', async () => {
    state.failTanks = true

    const page = await mountHome()

    expect(page.get('[data-testid="load-error"]').text()).toContain('載入失敗')
    expect(page.get('[data-testid="load-error-retry"]').exists()).toBe(true)
    expect(page.find('[data-testid="tank-empty"]').exists()).toBe(false)
  })

  // And 我不會被引導去建立第二個缸
  it('載入失敗時沒有任何前往建立缸的入口', async () => {
    state.failTanks = true

    const page = await mountHome()

    expect(page.text()).not.toContain('還沒有任何缸')
    expect(page.find('[data-testid="tank-empty-action"]').exists()).toBe(false)
    expect(page.findAll('a').map(link => link.attributes('href'))).not.toContain('/tanks/new')
  })

  // 缸清單成功、缸資料失敗是同一件事：畫面同樣不能假裝這個缸裡什麼都沒有
  it('缸資料回 500 時同樣顯示載入失敗，不顯示生物空狀態', async () => {
    state.failHome = true

    const page = await mountHome()

    expect(page.get('[data-testid="load-error"]').exists()).toBe(true)
    expect(page.find('[data-testid="creature-empty"]').exists()).toBe(false)
  })

  // Given 我真的沒有任何缸 / Then 畫面仍然顯示「還沒有任何缸／建立我的第一個缸」
  // （成功但空，與失敗，必須分得出來）
  it('成功但沒有缸時仍是空狀態，不是載入失敗', async () => {
    state.tanks = []

    const page = await mountHome()

    expect(page.find('[data-testid="load-error"]').exists()).toBe(false)
    expect(page.get('[data-testid="tank-empty"]').text()).toContain('還沒有任何缸')
    expect(page.get('[data-testid="tank-empty-action"]').attributes('href')).toBe('/tanks/new')
  })

  // Given 畫面顯示載入失敗 / When 我點「重試」
  // Then 重新發出同一個請求，成功後正常顯示
  it('點「重試」重新發出請求，成功後正常顯示', async () => {
    state.failTanks = true

    const page = await mountHome()

    expect(page.get('[data-testid="load-error"]').exists()).toBe(true)

    state.failTanks = false

    await page.get('[data-testid="load-error-retry"]').trigger('click')
    await flushPromises()

    // 重試是兩支請求接力，資料到齊會晚於「錯誤區塊消失」——等的是最終樣態
    await vi.waitFor(() => {
      expect(page.find('[data-testid="load-error"]').exists()).toBe(false)
      expect(page.get('[data-testid="creature-total"]').text()).toBe('12 隻')
    })

    expect(page.get('h1').text()).toBe('主缸 · 4 尺')
    expect(page.findAll('[data-testid="creature-card"]')).toHaveLength(11)
  })

  // 重試期間 status 會從 'error' 翻成 'pending'，「只看 error」的寫法會在那一段
  // 把錯誤區塊拆掉——畫面於是閃過一次「還沒有任何缸」，正是本 issue 要根除的那一幕
  it('重試進行中畫面停在載入失敗，不閃過空狀態', async () => {
    state.failTanks = true

    const page = await mountHome()

    state.failTanks = false

    // 刻意不 await：要看的正是「請求還在路上」的那一段
    void page.get('[data-testid="load-error-retry"]').trigger('click')
    await nextTick()

    expect(page.get('[data-testid="load-error"]').exists()).toBe(true)
    expect(page.find('[data-testid="tank-empty"]').exists()).toBe(false)
    expect(page.get('[data-testid="load-error-retry"]').attributes('disabled')).toBeDefined()

    // 收尾：這一輪本來就會成功，等它落地免得殘留到下一題
    await vi.waitFor(() => {
      expect(page.find('[data-testid="load-error"]').exists()).toBe(false)
    })
  })

  // 第二支請求失敗時按重試，重打的必須包含它——只重打缸清單的話，
  // 缸資料那一格會永遠停在失敗狀態，按幾次都一樣
  it('缸資料失敗時按重試也會重新取回缸資料', async () => {
    state.failHome = true

    const page = await mountHome()

    expect(page.get('[data-testid="load-error"]').exists()).toBe(true)

    state.failHome = false

    await page.get('[data-testid="load-error-retry"]').trigger('click')
    await flushPromises()

    await vi.waitFor(() => {
      expect(page.find('[data-testid="load-error"]').exists()).toBe(false)
      expect(page.get('[data-testid="creature-total"]').text()).toBe('12 隻')
    })
  })
})

describe('首頁 — 尚未建立任何缸', () => {
  it('沒有任何未封存的缸時顯示空狀態，而不是壞掉的頁首', async () => {
    state.tanks = []

    const page = await mountHome()

    expect(page.get('[data-testid="tank-empty"]').exists()).toBe(true)
    expect(page.find('[data-testid="tank-switch"]').exists()).toBe(false)
  })

  // Given 我是一個還沒有任何缸的使用者 / When 我開啟首頁
  // Then 空狀態除了說明文字之外，顯示一個「建立第一個缸」的主要行動按鈕
  it('空狀態除了說明文字，還有「建立第一個缸」的行動按鈕', async () => {
    state.tanks = []

    const page = await mountHome()
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

    const page = await mountHome()
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

    const page = await mountHome()

    expect(page.get('[data-testid="tank-empty-action"]').attributes('href')).toBe('/tanks/new')
  })
})

describe('首頁 — 從建立缸的表單導回', () => {
  // And 導回首頁，該缸成為當前缸，水質摘要列與生物列表都顯示各自的空狀態
  it('網址帶著 ?tank=<id> 時，該缸就是當前缸', async () => {
    state.tanks = [MAIN_TANK, SECOND_TANK]
    state.home = { 'tank-1': MAIN_TANK_HOME, 'tank-2': { water: null, creatures: [] } }

    const page = await mountHome('/?tank=tank-2')

    expect(page.get('h1').text()).toBe('軟體缸 · 2 尺')
    expect(page.get('[data-testid="water-empty"]').exists()).toBe(true)
    expect(page.get('[data-testid="creature-empty"]').exists()).toBe(true)
    expect(page.get('[data-testid="creature-total"]').text()).toBe('0 隻')
  })

  // 剛建立的第一個缸：displayOrder 為 0，清單裡就它一個
  it('剛建立的缸還沒有任何資料時，水質與生物都顯示空狀態', async () => {
    state.tanks = [MAIN_TANK]
    state.home = { 'tank-1': { water: null, creatures: [] } }

    const page = await mountHome('/?tank=tank-1')

    expect(page.get('h1').text()).toBe('主缸 · 4 尺')
    expect(page.get('[data-testid="water-empty"]').exists()).toBe(true)
    expect(page.get('[data-testid="creature-empty"]').exists()).toBe(true)
  })

  // 網址上的 tank 不在清單裡（缸被封存 / 換了裝置）時不能整頁壞掉，退回預設缸
  it('?tank=<id> 指到不存在的缸時退回預設缸', async () => {
    state.tanks = [MAIN_TANK, SECOND_TANK]

    const page = await mountHome('/?tank=tank-404')

    expect(page.get('h1').text()).toBe('主缸 · 4 尺')
  })
})

// issue #110：首頁在資料到齊前是一片空白，沒有載入樣態。
//
// #84 關掉 SSR 之後首屏沒有伺服器算好的畫面，而這一頁的 useAsyncData 原本是 await 的
// ——Suspense 於是擋著整頁不渲染，使用者看到的就是白的。訪客進站是這個作品集唯一
// 對外的路徑，第一印象就是那段空白。
describe('首頁 — 載入樣態', () => {
  it('資料還沒到時顯示骨架，而不是空白', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })

    expect(page.find('[data-testid="home-loading"]').exists()).toBe(true)
  })

  // 這一條是整張 issue 的重點：「還在載入」與「真的沒有缸」必須分得開。
  //
  // 分不開的話新訪客會先看到「你還沒有缸」再突然變出四個缸；更糟的是那個空狀態的
  // 唯一出口是「建立我的第一個缸」，照著按下去就多一個他不需要的缸。
  it('資料還沒到時不顯示空狀態，也沒有「建立我的第一個缸」', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })

    expect(page.find('[data-testid="tank-empty"]').exists()).toBe(false)
    expect(page.find('[data-testid="tank-empty-action"]').exists()).toBe(false)
  })

  it('資料到齊後骨架換成內容', async () => {
    const page = await mountHome()

    expect(page.find('[data-testid="home-loading"]').exists()).toBe(false)
    expect(page.get('h1').text()).toContain(MAIN_TANK.name)
  })

  // 骨架排在失敗之後：兩者的 data 都是 null，先問的那一個說了算。
  // 反過來的話重試期間（refresh 把 status 翻回 pending）會從錯誤畫面掉回骨架，
  // 而 #132 特地讓錯誤畫面在重試期間留著。
  it('拿不到資料時顯示的是載入失敗，不是骨架', async () => {
    state.failTanks = true

    const page = await mountHome()

    expect(page.find('[data-testid="load-error"]').exists()).toBe(true)
    expect(page.find('[data-testid="home-loading"]').exists()).toBe(false)
  })

  // 換缸時 data 還在，useAsyncData 保留上一份——整頁消失再長回來比等一下更難看懂
  // （與 /trends 換範圍時的處置一致）
  // 換缸時 data 還在，useAsyncData 保留上一份——整頁消失再長回來比等一下更難看懂
  it('換缸時不退回骨架', async () => {
    state.tanks = [MAIN_TANK, SECOND_TANK]

    const page = await mountHome()

    await page.get('[data-testid="tank-switch"]').trigger('click')
    await page.get('[data-testid="tank-menu"]').findAll('[role="option"]')[1]!.trigger('click')

    expect(page.find('[data-testid="home-loading"]').exists()).toBe(false)
  })

  // ⚠ 缸名要**立刻**翻過去，不能等兩支串接的請求都回來。
  //
  // 只看請求鏈算出來的那個缸，換缸之後畫面上唯一變的是「儀表板收起來了」——
  // 缸名、色塊、水質數字全是上一個缸的，持續一整個往返。使用者會以為沒點到
  // 而再點一次。缸清單在手上就算得出新缸是哪一個，沒有理由等。
  it('換缸之後頁首立刻改成新缸，不等內容回來', async () => {
    state.tanks = [MAIN_TANK, SECOND_TANK]

    const page = await mountHome()

    await page.get('[data-testid="tank-switch"]').trigger('click')
    await page.get('[data-testid="tank-menu"]').findAll('[role="option"]')[1]!.trigger('click')

    // 這一刻 /api/tanks/tank-2/home 還沒回來
    expect(page.get('h1').text()).toContain(SECOND_TANK.name)
  })
})

// issue #144：訪客的示範資料改成進站後才複製，首頁因此要分辨「準備中」與「真的沒有缸」。
//
// 複製要 11.5 秒，原本卡在 /auth/guest 的 302 之前，訪客只能對著登入頁乾等十幾秒。
// 搬出來之後那段等待落在這一頁上，而此刻 /api/tanks 回的是空清單——與「這個帳號
// 真的沒有缸」在畫面上一模一樣。
describe('首頁 — 訪客沙盒準備中', () => {
  beforeEach(() => {
    state.tanks = []
    state.sandboxAlreadySeeded = false
  })

  it('清單空著且還沒問到答案時，顯示「正在準備示範資料」', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })

    await flushPromises()

    expect(page.find('[data-testid="home-preparing"]').exists()).toBe(true)
    expect(page.get('[data-testid="home-preparing-title"]').text()).toBe('正在為你準備示範資料')
  })

  // 準備中不能有任何連出去的入口，「建立我的第一個缸」尤其不行：
  // 那顆按鈕在這一刻按下去，等於在示範資料落地的路上多插一個空缸。
  it('準備中不出現空狀態，也沒有「建立我的第一個缸」', async () => {
    const page = await mountSuspended(HomePage, { route: '/' })

    await flushPromises()

    expect(page.find('[data-testid="tank-empty"]').exists()).toBe(false)
    expect(page.find('[data-testid="tank-empty-action"]').exists()).toBe(false)
  })

  it('複製完成後換成示範缸的內容', async () => {
    const page = await mountHome()

    expect(page.find('[data-testid="home-preparing"]').exists()).toBe(false)
    expect(page.get('h1').text()).toContain(MAIN_TANK.name)
  })

  // 沒有欠著的沙盒（Google 使用者、或已經複製過的訪客）而清單仍然空著 ——
  // 這一刻才真的是「你還沒有缸」，空狀態與它的入口該出現
  it('伺服器說沒有欠著的沙盒時，空清單就是真的沒有缸', async () => {
    state.sandboxAlreadySeeded = true

    const page = await mountHome()

    expect(page.find('[data-testid="home-preparing"]').exists()).toBe(false)
    expect(page.find('[data-testid="tank-empty"]').exists()).toBe(true)
    expect(page.find('[data-testid="tank-empty-action"]').exists()).toBe(true)
  })

  // 準備失敗要看得見，而且要留下出口。停在「正在準備」上的話，
  // 那句話會從「請稍候」慢慢變成謊話，而使用者沒有任何辦法。
  it('準備失敗時顯示提示與重試，而不是一直轉圈', async () => {
    state.failSandbox = true

    const page = await mountHome()

    expect(page.find('[data-testid="home-preparing"]').exists()).toBe(false)
    expect(page.find('[data-testid="sandbox-error"]').exists()).toBe(true)
    expect(page.find('[data-testid="sandbox-error-retry"]').exists()).toBe(true)
  })

  // ⚠ 這一條是這一段的重點：**補建失敗不能把建立缸的出口一起拆掉。**
  //
  // 整頁的 LoadErrorState 刻意沒有任何連出去的入口（#132），把補建失敗也畫成它，
  // 代價是真的沒有缸的人被鎖在門外——Google 使用者的缸清單明明拿得到，
  // 卻只因為一支訪客專屬的 API 掛了就完全無法建立第一個缸。
  it('準備失敗時空狀態與「建立我的第一個缸」照常在', async () => {
    state.failSandbox = true

    const page = await mountHome()

    expect(page.find('[data-testid="load-error"]').exists()).toBe(false)
    expect(page.find('[data-testid="tank-empty"]').exists()).toBe(true)
    expect(page.get('[data-testid="tank-empty-action"]').attributes('href')).toBe('/tanks/new')
  })

  it('按下重試會再問一次，成功後換成示範缸的內容', async () => {
    state.failSandbox = true

    const page = await mountHome()

    state.failSandbox = false

    await page.get('[data-testid="sandbox-error-retry"]').trigger('click')

    // 等正面訊號（缸名出現），不是等提示消失——按下重試的那一瞬間提示就先不見了，
    // 而那時請求還在路上。這與 E2E 那邊的 #129 是同一個道理。
    await vi.waitFor(() => {
      expect(page.get('h1').text()).toContain(MAIN_TANK.name)
    })

    expect(page.find('[data-testid="sandbox-error"]').exists()).toBe(false)
  })

  // 成功那條路會 reload()，data 因此再變一次、watcher 又醒過來。
  // 少了「只問一次」那道閘門，這裡會變成無限重打——而每一次都是一支會寫入的 API。
  it('只問一次，不會因為重新取得資料而反覆重打', async () => {
    const page = await mountHome()

    await flushPromises()
    await flushPromises()

    expect(state.sandboxCalls).toBe(1)
    expect(page.get('h1').text()).toContain(MAIN_TANK.name)
  })

  // ⚠ 真正會無限重打的是**這一條**：POST 回來清單仍然是空的（模板沒 seed、
  // 或這位根本不是訪客）。ensureSandbox 成功時會 reload()，data 因此再變一次、
  // watcher 又醒過來——閘門一旦失效，每一次都是一支會寫入的 API。
  // 上面那條「只問一次」走的是「POST 之後就有缸」，守不到這裡。
  it('補建之後仍然沒有缸時，也只問一次', async () => {
    state.sandboxAlreadySeeded = true
    state.sandboxFilledByOther = false

    const page = await mountHome()

    await flushPromises()
    await flushPromises()

    expect(state.sandboxCalls).toBe(1)
    expect(page.find('[data-testid="tank-empty"]').exists()).toBe(true)
  })

  it('本來就有缸的話完全不問', async () => {
    state.tanks = [MAIN_TANK]

    await mountHome()

    expect(state.sandboxCalls).toBe(0)
  })
})

// issue #144：複製可能是**別人**做的。
//
// 冪等鎖（server/utils/guestSandbox.ts）保證只有一個呼叫者真的複製，其餘一律拿到
// alreadySeeded: true。所以「這一次呼叫沒做事」與「沒有資料」是兩件完全不同的事——
// 另一個分頁、或先前一次還在路上的請求，都可能已經把資料放進來了。
//
// 實際踩過（PR #145 的 E2E）：畫面等了 34 次輪詢仍是「還沒有任何缸」，而同一時間
// /api/tanks 已經回得出缸。原因就是這一頁只在 alreadySeeded 為 false 時才重新取。
describe('首頁 — 沙盒是別人複製完的', () => {
  beforeEach(() => {
    state.tanks = []
    state.sandboxAlreadySeeded = true
    state.sandboxFilledByOther = true
  })

  it('拿到 alreadySeeded: true 仍然重新取一次，換成示範缸的內容', async () => {
    const page = await mountHome()

    expect(page.find('[data-testid="tank-empty"]').exists()).toBe(false)
    expect(page.get('h1').text()).toContain(MAIN_TANK.name)
  })
})
