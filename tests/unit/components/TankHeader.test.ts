import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import TankHeader from '../../../app/components/TankHeader.vue'
import type { TankOption } from '#shared/types/home'

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

function mountHeader(tanks: TankOption[], currentTankId = tanks[0]!.id) {
  return mountSuspended(TankHeader, { route: '/', props: { tanks, currentTankId } })
}

function mountCollapsed(tanks: TankOption[], currentTankId = tanks[0]!.id) {
  return mountSuspended(TankHeader, { route: '/', props: { tanks, currentTankId, collapsed: true } })
}

/** 從 class 陣列取出 duration-<ms> 的毫秒數。過場的實際播放不在 unit 測試範圍，時長設定則驗得到 */
function transitionDurationMs(classes: string[]): number {
  const token = classes.find(name => /^duration-\d+$/.test(name))

  expect(token, `預期 class 中有 duration-<ms>，實際為 ${classes.join(' ')}`).toBeDefined()

  return Number(token!.slice('duration-'.length))
}

describe('TankHeader', () => {
  // Given 我有一個名為「主缸」的缸，設定為 4 尺 / SPS MIXED / 420L / When 我開啟首頁
  // Then 頁首顯示缸的代表色塊、缸名「主缸 · 4 尺」與副標「SPS MIXED · 420L」
  it('顯示缸名與副標', async () => {
    const header = await mountHeader([MAIN_TANK])

    expect(header.get('h1').text()).toBe('主缸 · 4 尺')
    expect(header.get('[data-testid="tank-subtitle"]').text()).toBe('SPS MIXED · 420L')
  })

  it('顯示缸的代表色塊，色值取自該缸的 colorHex', async () => {
    const header = await mountHeader([MAIN_TANK])
    const block = header.get('[data-testid="tank-color"]')

    expect(block.attributes('data-color')).toBe('#2dd4bf')
    expect(block.attributes('style')).toContain('background-color')
  })

  it('缺 sizeSpec / setupType / volumeLiters 時不留下多餘的分隔點', async () => {
    const header = await mountHeader([{
      id: 'tank-3',
      name: '檢疫缸',
      sizeSpec: null,
      volumeLiters: null,
      setupType: null,
      colorHex: null,
    }])

    expect(header.get('h1').text()).toBe('檢疫缸')
    expect(header.get('[data-testid="tank-subtitle"]').exists()).toBe(true)
    expect(header.get('[data-testid="tank-subtitle"]').text()).toBe('')
  })

  // Then 缸名右側有可切換的 ∨
  it('缸名右側有切換用的 ∨，預設收合', async () => {
    const header = await mountHeader([MAIN_TANK, SECOND_TANK])
    const toggle = header.get('[data-testid="tank-switch"]')

    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(toggle.attributes('aria-haspopup')).toBe('listbox')
    expect(header.find('[data-testid="tank-menu"]').exists()).toBe(false)
  })

  // Given 我有兩個以上未封存的缸 / When 我點擊缸名旁的 ∨ / Then 出現缸切換選單
  it('點擊 ∨ 後展開缸切換選單，依傳入的順序列出所有缸', async () => {
    const header = await mountHeader([MAIN_TANK, SECOND_TANK])

    await header.get('[data-testid="tank-switch"]').trigger('click')

    const options = header.get('[data-testid="tank-menu"]').findAll('[role="option"]')
    expect(options.map(option => option.text())).toEqual(['主缸 · 4 尺', '軟體缸 · 2 尺'])
    expect(options.map(option => option.attributes('aria-selected'))).toEqual(['true', 'false'])
    expect(header.get('[data-testid="tank-switch"]').attributes('aria-expanded')).toBe('true')
  })

  // When 我選擇另一個缸 / Then 首頁的水質摘要與生物列表改為顯示該缸的資料
  // （此元件只負責把選擇往上拋，實際換資料由首頁承接）
  it('選擇另一個缸時拋出 select 事件並收起選單', async () => {
    const header = await mountHeader([MAIN_TANK, SECOND_TANK])

    await header.get('[data-testid="tank-switch"]').trigger('click')
    await header.get('[data-testid="tank-menu"]').findAll('[role="option"]')[1]!.trigger('click')

    expect(header.emitted('select')).toEqual([['tank-2']])
    expect(header.find('[data-testid="tank-menu"]').exists()).toBe(false)
  })

  // Given 我已經有至少一個缸 / When 我點擊頁首缸名旁的 ∨
  // Then 切換選單底部同樣有「新增缸」的入口
  it('切換選單底部有「新增缸」的入口，連向建立缸的表單', async () => {
    const header = await mountHeader([MAIN_TANK, SECOND_TANK])

    await header.get('[data-testid="tank-switch"]').trigger('click')

    const create = header.get('[data-testid="tank-menu-create"]')
    expect(create.text()).toContain('新增缸')
    expect(create.attributes('href')).toBe('/tanks/new')

    // 入口不是缸，不能混進 listbox 的選項裡被當成「切到某個缸」
    expect(header.get('[data-testid="tank-menu"]').findAll('[role="option"]')).toHaveLength(2)
  })

  it('選單收合時看不到「新增缸」的入口', async () => {
    const header = await mountHeader([MAIN_TANK])

    expect(header.find('[data-testid="tank-menu-create"]').exists()).toBe(false)
  })

  // issue 的「已知缺口」：右上角圓形圖示在 schema 中沒有任何對應，
  // 本 issue 先渲染為無作用的裝飾按鈕，實際行為待人類確認後另開 issue
  it('右上角的圓形圖示是無作用的裝飾，不進入 tab 順序', async () => {
    const header = await mountHeader([MAIN_TANK])
    const ornament = header.get('[data-testid="tank-header-ornament"]')

    expect(ornament.attributes('disabled')).toBeDefined()
    expect(ornament.attributes('aria-hidden')).toBe('true')
    expect(ornament.attributes('tabindex')).toBe('-1')
  })
})

// When 我向下捲動 / Then 頁首收合——副標讓位，只留「我在看哪一缸」需要的缸名與切換入口
//
// issue #55：讓位從 v-if 換成可補間的形式（外層 grid，1fr → 0fr）。節點留在 DOM 裡，
// 所以判準從「副標不存在」換成「整塊收到 0 高、並對輔助技術隱藏」。
describe('TankHeader — 收合', () => {
  it('收合時副標整塊讓位，並對輔助技術隱藏', async () => {
    const header = await mountCollapsed([MAIN_TANK])
    const slot = header.get('[data-testid="tank-subtitle-slot"]')

    expect(slot.attributes('data-collapsed')).toBe('true')
    expect(slot.classes()).toContain('grid-rows-[0fr]')
    expect(slot.classes()).toContain('opacity-0')

    // 畫面上看不見的東西不能讓螢幕報讀念到
    expect(slot.attributes('aria-hidden')).toBe('true')
  })

  it('收合時副標文字留在 DOM 裡——移掉節點就沒得補間了', async () => {
    const header = await mountCollapsed([MAIN_TANK])

    expect(header.get('[data-testid="tank-subtitle"]').text()).toBe('SPS MIXED · 420L')
  })

  it('收合時缸名、色塊與切換 ∨ 都還在', async () => {
    const header = await mountCollapsed([MAIN_TANK])

    expect(header.get('h1').text()).toBe('主缸 · 4 尺')
    expect(header.get('[data-testid="tank-color"]').attributes('data-color')).toBe('#2dd4bf')
    expect(header.get('[data-testid="tank-switch"]').exists()).toBe(true)
  })

  it('展開時副標區塊還原，不再對輔助技術隱藏', async () => {
    const header = await mountHeader([MAIN_TANK])
    const slot = header.get('[data-testid="tank-subtitle-slot"]')

    expect(slot.attributes('data-collapsed')).toBe('false')
    expect(slot.classes()).toContain('grid-rows-[1fr]')
    expect(slot.classes()).toContain('opacity-100')
    expect(slot.attributes('aria-hidden')).toBeUndefined()
  })

  // Given 系統設定為「減少動態效果」/ Then 直接切換、不播放過場
  it('讓位區塊帶著過場，且「減少動態效果」時停用', async () => {
    const classes = (await mountCollapsed([MAIN_TANK])).get('[data-testid="tank-subtitle-slot"]').classes()

    expect(classes.some(name => name.startsWith('transition-'))).toBe(true)
    expect(classes).toContain('motion-reduce:transition-none')

    // backdrop blur 已經夠貴，過場再長會在中階手機上看得出掉幀
    expect(transitionDurationMs(classes)).toBeGreaterThanOrEqual(150)
    expect(transitionDurationMs(classes)).toBeLessThanOrEqual(250)
  })

  it('收合時仍然打得開切換選單', async () => {
    const header = await mountCollapsed([MAIN_TANK, SECOND_TANK])

    await header.get('[data-testid="tank-switch"]').trigger('click')

    expect(header.get('[data-testid="tank-menu"]').findAll('[role="option"]')).toHaveLength(2)
  })

  it('預設不收合', async () => {
    const header = await mountHeader([MAIN_TANK])

    expect(header.get('[data-testid="tank-subtitle"]').text()).toBe('SPS MIXED · 420L')
    expect(header.get('[data-testid="tank-subtitle-slot"]').attributes('data-collapsed')).toBe('false')
  })
})
