import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import CreaturesPage from '../../../app/pages/creatures/index.vue'
import type { TankOption } from '#shared/types/home'
import type { CreatureListItemDto } from '#shared/types/creature'

const MAIN_TANK: TankOption = {
  id: 'tank-1',
  name: '主缸',
  sizeSpec: '4 尺',
  volumeLiters: 420,
  setupType: 'SPS MIXED',
  colorHex: '#2dd4bf',
}

// 入缸月數與觀察天數都是「相對現在」的推算值，
// 固定資料 + 真實時鐘會隨日期漂移，所以夾具反過來由現在往回推。
function monthsAgo(months: number): string {
  const date = new Date()
  date.setUTCMonth(date.getUTCMonth() - months)
  return date.toISOString().slice(0, 10)
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function creature(
  overrides: Partial<CreatureListItemDto> & Pick<CreatureListItemDto, 'id' | 'name'>,
): CreatureListItemDto {
  return {
    scientificName: null,
    category: 'FISH',
    status: 'ALIVE',
    photoUrl: null,
    addedOn: monthsAgo(8),
    ailment: null,
    observedSickOn: null,
    diedOn: null,
    causeOfDeath: null,
    ...overrides,
  }
}

// Given 該缸有 12 隻生物：魚 5、珊瑚 6、其他 1（screen-5 的截圖內容）
const MAIN_TANK_CREATURES: CreatureListItemDto[] = [
  creature({ id: 'f1', name: '藍倒吊', scientificName: 'Paracanthurus', addedOn: monthsAgo(8) }),
  creature({ id: 'f2', name: '公子小丑 ×2', scientificName: 'Amphiprion', addedOn: monthsAgo(10) }),
  creature({
    id: 'f3',
    name: '黃三角',
    scientificName: 'Zebrasoma flavescens',
    status: 'SICK',
    ailment: '白點',
    observedSickOn: daysAgo(3),
  }),
  creature({ id: 'f4', name: '六線龍', scientificName: 'Pseudocheilinus', addedOn: monthsAgo(6) }),
  creature({
    id: 'f5',
    name: '火焰仙',
    scientificName: 'Centropyge loriculus',
    status: 'DEAD',
    diedOn: '2026-05-20',
    causeOfDeath: 'JUMPED',
  }),
  ...Array.from({ length: 6 }, (_, index) => creature({
    id: `c${index}`,
    name: `珊瑚${index}`,
    category: 'CORAL',
  })),
  creature({ id: 'o1', name: '白襪清潔蝦', category: 'OTHER' }),
]

const state = {
  tanks: [] as TankOption[],
  creatures: [] as CreatureListItemDto[],
}

registerEndpoint('/api/tanks', () => ({ tanks: state.tanks }))
registerEndpoint('/api/tanks/tank-1/creatures', () => ({ creatures: state.creatures }))

enableAutoUnmount(afterEach)

beforeEach(() => {
  // useAsyncData 的結果會留在 payload 上，測試之間必須清掉才不會拿到上一題的資料
  clearNuxtData()

  state.tanks = [MAIN_TANK]
  state.creatures = MAIN_TANK_CREATURES
})

type Page = Awaited<ReturnType<typeof mountSuspended>>

function open() {
  return mountSuspended(CreaturesPage, { route: '/creatures' })
}

function tabTexts(page: Page) {
  return page.findAll('[data-testid="category-tab"]').map(tab => tab.text())
}

function filterChip(page: Page, status: string) {
  return page.get(`[data-testid="status-filter"][data-status="${status}"]`)
}

function rowTitles(page: Page) {
  return page.findAll('[data-testid="creature-name"]').map(name => name.text())
}

function rowSubtitles(page: Page) {
  return page.findAll('[data-testid="creature-subtitle"]').map(subtitle => subtitle.text())
}

describe('生物庫存 — 頁首', () => {
  // Given 我進入「生物」頁 / When 畫面載入
  // Then 頁首顯示「生物庫存」與副標「<缸名> · N 隻」，右上角有「＋ 新增」按鈕
  it('顯示標題、缸名與總隻數，右上角有新增按鈕', async () => {
    const page = await open()

    expect(page.get('h1').text()).toBe('生物庫存')
    expect(page.get('[data-testid="inventory-subtitle"]').text()).toBe('主缸 · 12 隻')

    const add = page.get('[data-testid="creature-add"]')
    expect(add.text()).toContain('新增')
    expect(add.attributes('href')).toBe('/creatures/new')
  })
})

describe('生物庫存 — 分類 tab 與狀態 filter', () => {
  // And 分類 tab 顯示「魚 · 5」「珊瑚 · 6」「其他 · 1」，各帶該分類的數量
  it('三個分類 tab 各帶該分類的數量', async () => {
    const page = await open()

    expect(tabTexts(page)).toEqual(['魚 · 5', '珊瑚 · 6', '其他 · 1'])
  })

  // And 狀態 filter 顯示「全部 / 存活 / 生病 / 死亡」，預設選中「全部」
  it('狀態 filter 有四個選項，預設選中「全部」', async () => {
    const page = await open()

    const chips = page.findAll('[data-testid="status-filter"]')
    expect(chips.map(chip => chip.text())).toEqual(['全部', '存活', '生病', '死亡'])
    expect(chips.map(chip => chip.attributes('aria-pressed'))).toEqual(['true', 'false', 'false', 'false'])
  })

  // 分類 tab 上的數量是「不受狀態 filter 影響的分類總數」（issue #13「已知缺口」）
  it('切換狀態 filter 不改變分類 tab 上的數量', async () => {
    const page = await open()

    await filterChip(page, 'SICK').trigger('click')

    expect(tabTexts(page)).toEqual(['魚 · 5', '珊瑚 · 6', '其他 · 1'])
  })
})

describe('生物庫存 — 列表篩選', () => {
  // Given 我在「魚」分類且狀態 filter 為「全部」/ When 列表渲染
  // Then 只顯示 category 為 FISH 的生物，包含存活、生病與死亡者
  it('預設在「魚」分類，列出全部五隻魚（含生病與死亡）', async () => {
    const page = await open()

    expect(page.findAll('[data-testid="category-tab"]')[0]!.attributes('aria-selected')).toBe('true')
    expect(rowTitles(page)).toEqual(['藍倒吊', '公子小丑 ×2', '黃三角', '六線龍', '火焰仙'])
    expect(
      page.findAll('[data-testid="creature-row"]').map(row => row.attributes('data-status')),
    ).toEqual(['ALIVE', 'ALIVE', 'SICK', 'ALIVE', 'DEAD'])
  })

  // When 我點擊狀態「生病」/ Then 只顯示 status 為 SICK 的魚，該 filter chip 呈橘色選中態
  it('點擊「生病」後只留下生病的魚，該 chip 呈橘色選中態', async () => {
    const page = await open()

    await filterChip(page, 'SICK').trigger('click')

    expect(rowTitles(page)).toEqual(['黃三角'])

    const chip = filterChip(page, 'SICK')
    expect(chip.attributes('aria-pressed')).toBe('true')
    expect(chip.classes().some(name => name.includes('amber'))).toBe(true)
  })

  it('切換到「珊瑚」分類後只顯示珊瑚', async () => {
    const page = await open()

    await page.findAll('[data-testid="category-tab"]')[1]!.trigger('click')

    expect(page.findAll('[data-testid="creature-row"]')).toHaveLength(6)
    expect(rowTitles(page)).toEqual(['珊瑚0', '珊瑚1', '珊瑚2', '珊瑚3', '珊瑚4', '珊瑚5'])
  })

  // Given 目前的分類與狀態組合沒有任何生物 / When 列表渲染
  // Then 顯示空狀態文案，而非空白區塊
  it('分類與狀態的組合沒有生物時顯示空狀態文案', async () => {
    const page = await open()

    await page.findAll('[data-testid="category-tab"]')[2]!.trigger('click')
    await filterChip(page, 'DEAD').trigger('click')

    expect(page.findAll('[data-testid="creature-row"]')).toHaveLength(0)
    expect(page.get('[data-testid="creature-empty"]').text()).not.toBe('')
  })
})

describe('生物庫存 — 每一列的內容', () => {
  // Given 某隻存活生物有學名且入缸 8 個月 / When 該列渲染
  // Then 第一行顯示俗名，第二行顯示「<學名> · 入缸 8 月」，右側顯示綠點與「存活」
  it('存活列：俗名、「<學名> · 入缸 N 月」、綠點與「存活」', async () => {
    const page = await open()
    const row = page.findAll('[data-testid="creature-row"]')[0]!

    expect(row.get('[data-testid="creature-name"]').text()).toBe('藍倒吊')
    expect(row.get('[data-testid="creature-subtitle"]').text()).toBe('Paracanthurus · 入缸 8 月')
    expect(row.get('[data-testid="creature-status"]').text()).toBe('存活')

    const dot = row.get('[data-testid="creature-status-dot"]')
    expect(dot.attributes('data-status')).toBe('ALIVE')
    expect(dot.classes()).toContain('bg-primary')
  })

  // Given 某隻生物沒有填學名 / When 該列渲染
  // Then 第二行只顯示「入缸 N 月」，不出現多餘的分隔點
  it('沒有學名的列，第二行只有「入缸 N 月」', async () => {
    state.creatures = [creature({ id: 'f1', name: '藍倒吊', scientificName: null, addedOn: monthsAgo(8) })]

    const page = await open()
    const subtitle = page.get('[data-testid="creature-subtitle"]')

    expect(subtitle.text()).toBe('入缸 8 月')
    expect(subtitle.text()).not.toContain('·')
  })

  // Given 某隻生物狀態為生病，症狀為白點，發病日為 3 天前 / When 該列渲染
  // Then 第二行顯示「白點 · 觀察第 3 天」，右側顯示橘點與「生病」，整列底色轉橘
  it('生病列：「<症狀> · 觀察第 N 天」、橘點、「生病」與橘色底', async () => {
    const page = await open()
    const row = page.findAll('[data-testid="creature-row"]')[2]!

    expect(row.get('[data-testid="creature-name"]').text()).toBe('黃三角')
    expect(row.get('[data-testid="creature-subtitle"]').text()).toBe('白點 · 觀察第 3 天')
    expect(row.get('[data-testid="creature-status"]').text()).toBe('生病')
    expect(row.get('[data-testid="creature-status-dot"]').classes().some(name => name.includes('amber'))).toBe(true)

    // 整列底色轉橘
    expect(row.classes().some(name => /^bg-amber/.test(name))).toBe(true)
  })

  // Given 某隻生物狀態為死亡，死因為跳缸，死亡日為 05/20 / When 該列渲染
  // Then 第二行顯示「跳缸 · 05 / 20」，右側顯示灰點與「死亡」，整列降低透明度
  it('死亡列：「<死因> · MM / DD」、灰點、「死亡」與降低的透明度', async () => {
    const page = await open()
    const row = page.findAll('[data-testid="creature-row"]')[4]!

    expect(row.get('[data-testid="creature-name"]').text()).toBe('火焰仙')
    expect(row.get('[data-testid="creature-subtitle"]').text()).toBe('跳缸 · 05 / 20')
    expect(row.get('[data-testid="creature-status"]').text()).toBe('死亡')
    expect(row.get('[data-testid="creature-status-dot"]').classes().some(name => name.includes('neutral'))).toBe(true)

    expect(row.classes().some(name => /^opacity-\d+$/.test(name))).toBe(true)
  })

  // Given 某隻生物俗名含有數量 / When 該列渲染
  // Then 正常顯示含有數量的俗名，不自動將該筆視為多隻生物
  it('俗名含數量時照原樣顯示，總隻數與該列都只算一隻', async () => {
    state.creatures = [
      creature({ id: 'a', name: '公子小丑 ×2', scientificName: 'Amphiprion', addedOn: monthsAgo(10) }),
      creature({ id: 'b', name: '公子小丑 ×2', scientificName: 'Amphiprion', addedOn: monthsAgo(10) }),
    ]

    const page = await open()

    expect(page.get('[data-testid="inventory-subtitle"]').text()).toBe('主缸 · 2 隻')
    expect(rowTitles(page)).toEqual(['公子小丑 ×2', '公子小丑 ×2'])
    expect(rowSubtitles(page)).toEqual(['Amphiprion · 入缸 10 月', 'Amphiprion · 入缸 10 月'])
  })

  // Given 我在生物庫存列表 / When 我點擊任一列 / Then 導向該生物的「生物詳情」頁
  it('每一列都連向該生物的詳情頁', async () => {
    const page = await open()
    const links = page.findAll('[data-testid="creature-row"] a')

    expect(links[0]!.attributes('href')).toBe('/creatures/f1')
    expect(links[4]!.attributes('href')).toBe('/creatures/f5')
  })
})

describe('生物庫存 — 尚未建立任何缸', () => {
  // 「<缸名> · N 隻」在沒有缸的時候無從顯示，整頁不能因此壞掉
  it('沒有任何缸時顯示空狀態與建立缸的入口', async () => {
    state.tanks = []
    state.creatures = []

    const page = await open()

    expect(page.get('[data-testid="tank-empty"]').exists()).toBe(true)
    expect(page.get('[data-testid="tank-empty-action"]').attributes('href')).toBe('/tanks/new')
    expect(page.findAll('[data-testid="creature-row"]')).toHaveLength(0)
  })
})
