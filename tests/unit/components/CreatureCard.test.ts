import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import CreatureCard from '../../../app/components/CreatureCard.vue'
import type { CreatureCardModel } from '../../../shared/utils/creatureCards'

const ALIVE: CreatureCardModel = {
  id: 'c1',
  name: '藍倒吊',
  title: '藍倒吊',
  count: 1,
  category: 'FISH',
  status: 'ALIVE',
  photoUrl: null,
  ailment: null,
  months: 8,
  subtitle: '存活 · 8 月',
}

const SICK: CreatureCardModel = {
  ...ALIVE,
  id: 'c2',
  name: '黃三角',
  title: '黃三角',
  status: 'SICK',
  ailment: '白點',
  subtitle: '生病 · 白點',
}

const DEAD: CreatureCardModel = {
  ...ALIVE,
  id: 'c9',
  name: '六線龍',
  title: '六線龍',
  status: 'DEAD',
  months: 3,
  subtitle: '死亡 · 3 月',
}

function mountCard(card: CreatureCardModel) {
  return mountSuspended(CreatureCard, { route: '/', props: { card } })
}

describe('CreatureCard', () => {
  // Then 每張卡片左上角顯示分類標籤（魚 / 珊瑚 / 其他）、
  //      右上角顯示狀態點（存活綠 / 生病橘 / 死亡灰）
  it('左上角顯示分類標籤', async () => {
    expect((await mountCard(ALIVE)).get('[data-testid="creature-category"]').text()).toBe('魚')
    expect((await mountCard({ ...ALIVE, category: 'CORAL' })).get('[data-testid="creature-category"]').text()).toBe('珊瑚')
    expect((await mountCard({ ...ALIVE, category: 'OTHER' })).get('[data-testid="creature-category"]').text()).toBe('其他')
  })

  it('右上角的狀態點：存活為主色、生病為橘、死亡為灰', async () => {
    const alive = (await mountCard(ALIVE)).get('[data-testid="creature-status-dot"]')
    const sick = (await mountCard(SICK)).get('[data-testid="creature-status-dot"]')
    const dead = (await mountCard(DEAD)).get('[data-testid="creature-status-dot"]')

    expect(alive.attributes('data-status')).toBe('ALIVE')
    expect(alive.classes()).toContain('bg-primary')

    expect(sick.attributes('data-status')).toBe('SICK')
    expect(sick.classes()).toContain('bg-amber-400')

    expect(dead.attributes('data-status')).toBe('DEAD')
    expect(dead.classes()).toContain('bg-neutral-500')
  })

  // Then 存活卡片副標為「存活 · N 月」
  it('存活卡片顯示名稱與「存活 · N 月」', async () => {
    const card = await mountCard(ALIVE)

    expect(card.get('[data-testid="creature-title"]').text()).toBe('藍倒吊')
    expect(card.get('[data-testid="creature-subtitle"]').text()).toBe('存活 · 8 月')
    expect(card.find('[data-testid="creature-watch-flag"]').exists()).toBe(false)
  })

  // Then 生病卡片副標為「生病 · <症狀>」，卡片底色轉橘並在圖片區顯示「⚠ 觀察中」
  it('生病卡片底色轉橘，圖片區顯示「觀察中」', async () => {
    const card = await mountCard(SICK)

    expect(card.get('[data-testid="creature-subtitle"]').text()).toBe('生病 · 白點')
    expect(card.get('[data-testid="creature-watch-flag"]').text()).toContain('觀察中')
    expect(card.get('[data-testid="creature-card"]').classes().some(name => name.includes('amber'))).toBe(true)
  })

  // Then 死亡卡片整體降透明度，副標為「死亡 · N 月」
  it('死亡卡片整體降透明度', async () => {
    const card = await mountCard(DEAD)

    expect(card.get('[data-testid="creature-subtitle"]').text()).toBe('死亡 · 3 月')
    expect(card.get('[data-testid="creature-card"]').classes()).toContain('opacity-50')
  })

  // Then 兩者合併為一張卡片，標題顯示「公子小丑 ×2」
  it('合併後的卡片標題帶上 ×N', async () => {
    const card = await mountCard({ ...ALIVE, id: 'a', name: '公子小丑', title: '公子小丑 ×2', count: 2 })

    expect(card.get('[data-testid="creature-title"]').text()).toBe('公子小丑 ×2')
  })

  // Given 我在首頁 / When 我點擊任一張生物卡片 / Then 導向該生物的「生物詳情」頁
  it('整張卡片是連向生物詳情頁的連結', async () => {
    const card = await mountCard(ALIVE)
    const link = card.get('a')

    expect(link.attributes('href')).toBe('/creatures/c1')
    expect(link.attributes('aria-label')).toBe('藍倒吊 · 存活 · 8 月')
  })

  it('合併後的卡片連向群組中代表個體的詳情頁', async () => {
    const card = await mountCard({ ...ALIVE, id: 'a', name: '公子小丑', title: '公子小丑 ×2', count: 2 })

    expect(card.get('a').attributes('href')).toBe('/creatures/a')
  })

  it('沒有照片時以預設圖示填滿圖片區', async () => {
    const card = await mountCard(ALIVE)

    expect(card.find('img').exists()).toBe(false)
    expect(card.get('[data-testid="creature-photo"]').exists()).toBe(true)
  })

  it('有照片時渲染照片', async () => {
    const card = await mountCard({ ...ALIVE, photoUrl: 'https://example.test/blue-tang.jpg' })
    const image = card.get('img')

    expect(image.attributes('src')).toBe('https://example.test/blue-tang.jpg')
    expect(image.attributes('alt')).toBe('藍倒吊')
  })
})
