import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import LogPage from '../../../app/pages/log.vue'
import TrendsPage from '../../../app/pages/trends.vue'
import CreaturesPage from '../../../app/pages/creatures/index.vue'
import CreatureDetailPage from '../../../app/pages/creatures/[id].vue'
import MaintenancePage from '../../../app/pages/maintenance.vue'

// Given 我正在任一個 tab 頁面 / When 我點擊底部另一個 tab
// Then 路由切換到該頁面 —— 五個 tab 的目的地都要有頁面可落地
describe('tab 目的地頁面', () => {
  it.each([
    ['記錄', LogPage, '/log'],
    ['趨勢', TrendsPage, '/trends'],
    ['生物', CreaturesPage, '/creatures'],
    ['保養', MaintenancePage, '/maintenance'],
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
