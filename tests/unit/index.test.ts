import { describe, expect, it } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import IndexPage from '../../app/pages/index.vue'
import type { TankOption } from '../../shared/types/home'

// 首頁的驗收條件逐條覆蓋在 tests/unit/pages/home.test.ts；
// 這裡留的是 issue #9「已知缺口」列到的那一項——「＋ 新增」按鈕本身。

const TANK: TankOption = {
  id: 'tank-1',
  name: '主缸',
  sizeSpec: '4 尺',
  volumeLiters: 420,
  setupType: 'SPS MIXED',
  colorHex: '#2dd4bf',
}

registerEndpoint('/api/tanks', () => ({ tanks: [TANK] }))
registerEndpoint('/api/tanks/tank-1/home', () => ({ water: null, creatures: [] }))

describe('首頁的「＋ 新增」生物按鈕', () => {
  // 目標表單畫面 Epic 中沒有截圖，由另一支 needs-design 的
  // 「新增 / 編輯生物表單」issue 負責；本 issue 只渲染按鈕並連向該路由。
  it('渲染為連向新增生物路由的按鈕', async () => {
    const page = await mountSuspended(IndexPage, { route: '/' })
    const addButton = page.findAll('a').find(link => link.text().includes('新增'))

    expect(addButton).toBeDefined()
    expect(addButton!.attributes('href')).toBe('/creatures/new')
  })
})
