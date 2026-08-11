import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import TrendsPage from '../../../app/pages/trends.vue'
import CreatureDetailPage from '../../../app/pages/creatures/[id]/index.vue'

// Given 我正在任一個 tab 頁面 / When 我點擊底部另一個 tab
// Then 路由切換到該頁面 —— 五個 tab 的目的地都要有頁面可落地。
//
// 「生物」的目的地已由 issue #13 實作成生物庫存頁（標題「生物庫存」，需要 API 夾具），
// 它的落地由 tests/unit/pages/creatures.test.ts 覆蓋。「記錄」同樣已由 issue #124
// 實作成記錄水質頁（標題「記錄水質」），由 tests/unit/pages/water-log.test.ts 覆蓋。
// 「保養」則由 issue #125 實作成保養提醒頁（標題「保養提醒」，同樣需要 API 夾具），
// 由 tests/unit/pages/maintenance.test.ts 覆蓋。這裡只剩下仍是骨架的「趨勢」。
describe('tab 目的地頁面', () => {
  it.each([
    ['趨勢', TrendsPage, '/trends'],
  ])('%s 頁面渲染同名標題', async (title, component, route) => {
    const page = await mountSuspended(component, { route })

    expect(page.get('h1').text()).toBe(title)
  })

  // Given 我正在「生物詳情」這類子頁面（畫面上方為 ← 返回）
  it('生物詳情子頁面上方有返回生物列表的入口', async () => {
    const page = await mountSuspended(CreatureDetailPage, { route: '/creatures/demo-creature-id' })
    const back = page.get('a')

    expect(back.attributes('href')).toBe('/creatures')
    expect(back.attributes('aria-label')).toBe('返回生物列表')
  })
})
