import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import HomePage from '../../../app/pages/index.vue'
import type { CreatureDto, TankHomeData, TankOption } from '../../../shared/types/home'

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

function monthsAgo(months: number): string {
  const date = new Date()
  date.setUTCMonth(date.getUTCMonth() - months)
  return date.toISOString().slice(0, 10)
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
    targets: [],
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

registerEndpoint('/api/tanks', () => ({ tanks: state.tanks }))
registerEndpoint('/api/tanks/tank-1/home', () => state.home['tank-1'] ?? { water: null, creatures: [] })
registerEndpoint('/api/tanks/tank-2/home', () => state.home['tank-2'] ?? { water: null, creatures: [] })

// 上一題掛著沒拆的頁面會共用同一組 useAsyncData key，
// clearNuxtData() 讓它的 watcher 跟著醒過來去搶同一份資料。每題結束就拆掉。
enableAutoUnmount(afterEach)

beforeEach(() => {
  // useAsyncData 的結果會留在 payload 上，測試之間必須清掉才不會拿到上一題的缸
  clearNuxtData()

  state.tanks = [MAIN_TANK]
  state.home = { 'tank-1': MAIN_TANK_HOME, 'tank-2': SECOND_TANK_HOME }
})

function chipTexts(page: Awaited<ReturnType<typeof mountSuspended>>) {
  return page.findAll('[data-testid="creature-chip"]').map(chip => chip.text())
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

describe('首頁 — 尚未建立任何缸', () => {
  it('沒有任何未封存的缸時顯示空狀態，而不是壞掉的頁首', async () => {
    state.tanks = []

    const page = await mountSuspended(HomePage, { route: '/' })

    expect(page.get('[data-testid="tank-empty"]').exists()).toBe(true)
    expect(page.find('[data-testid="tank-switch"]').exists()).toBe(false)
  })
})
