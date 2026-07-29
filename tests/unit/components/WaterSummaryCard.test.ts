import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import WaterSummaryCard from '../../../app/components/WaterSummaryCard.vue'
import type { WaterSummaryDto } from '#shared/types/home'

const NOW = new Date('2026-07-28T09:41:00.000Z')

// Given 該缸最新一筆水質記錄為 4 小時前，其中 Mg 低於正常區間、NO₃ 高於正常區間
const WATER: WaterSummaryDto = {
  measuredAt: '2026-07-28T05:41:00.000Z',
  readings: [
    { parameter: 'KH', value: 7.8 },
    { parameter: 'CA', value: 412 },
    { parameter: 'MG', value: 1180 },
    { parameter: 'NO3', value: 12 },
    { parameter: 'PO4', value: 0.04 },
    { parameter: 'SALINITY', value: 1.026 },
  ],
  targets: [],
}

function mountCard(water: WaterSummaryDto | null) {
  return mountSuspended(WaterSummaryCard, { route: '/', props: { water, now: NOW } })
}

describe('WaterSummaryCard — 有水質記錄', () => {
  // Then 水質摘要列顯示「水質」標題、橘色徽章「2 需注意」與相對時間「· 4h」
  it('顯示標題、需注意徽章與相對時間', async () => {
    const card = await mountCard(WATER)

    expect(card.get('[data-testid="water-title"]').text()).toBe('水質')

    const badge = card.get('[data-testid="water-attention"]')
    expect(badge.text()).toBe('2 需注意')
    expect(badge.classes().some(name => name.includes('amber'))).toBe(true)

    expect(card.get('[data-testid="water-measured-at"]').text()).toBe('· 4h')
  })

  // Then 六項元素 KH / Ca / Mg / NO₃ / PO₄ / 鹽 以彩色數字並排顯示
  it('六項元素並排顯示標籤與數值', async () => {
    const card = await mountCard(WATER)
    const items = card.findAll('[data-testid="water-reading"]')

    expect(items.map(item => item.get('[data-testid="water-reading-label"]').text())).toEqual([
      'KH',
      'Ca',
      'Mg',
      'NO₃',
      'PO₄',
      '鹽',
    ])
    expect(items.map(item => item.get('[data-testid="water-reading-value"]').text())).toEqual([
      '7.8',
      '412',
      '1180',
      '12',
      '.04',
      '1.026',
    ])
  })

  // Then 正常項為綠色、偏低為藍色、偏高為橘色
  it('正常為主色（截圖的綠）、偏低為藍色、偏高為橘色', async () => {
    const card = await mountCard(WATER)
    const values = card.findAll('[data-testid="water-reading-value"]')

    expect(values.map(value => value.attributes('data-status'))).toEqual([
      'normal',
      'normal',
      'low',
      'high',
      'normal',
      'normal',
    ])

    expect(values[0]!.classes()).toContain('text-primary')
    expect(values[2]!.classes()).toContain('text-blue-400')
    expect(values[3]!.classes()).toContain('text-amber-400')
  })

  it('全部落在正常區間時不顯示需注意徽章', async () => {
    const card = await mountCard({
      ...WATER,
      readings: [{ parameter: 'KH', value: 7.8 }],
    })

    expect(card.find('[data-testid="water-attention"]').exists()).toBe(false)
    expect(card.get('[data-testid="water-measured-at"]').text()).toBe('· 4h')
  })
})

describe('WaterSummaryCard — 尚無水質記錄', () => {
  // Given 該缸尚無任何水質記錄 / When 我開啟首頁
  // Then 水質摘要列顯示空狀態（不顯示「N 需注意」徽章與相對時間），並提供前往記錄水質的入口
  it('不顯示徽章與相對時間，改顯示空狀態與記錄入口', async () => {
    const card = await mountCard(null)

    expect(card.get('[data-testid="water-title"]').text()).toBe('水質')
    expect(card.find('[data-testid="water-attention"]').exists()).toBe(false)
    expect(card.find('[data-testid="water-measured-at"]').exists()).toBe(false)
    expect(card.findAll('[data-testid="water-reading"]')).toHaveLength(0)

    const entry = card.get('[data-testid="water-empty-action"]')
    expect(entry.attributes('href')).toBe('/log')
    expect(card.get('[data-testid="water-empty"]').text()).toContain('還沒有水質記錄')
  })
})
