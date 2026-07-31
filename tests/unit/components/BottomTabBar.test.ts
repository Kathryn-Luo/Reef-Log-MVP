import { describe, expect, it } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import BottomTabBar from '../../../app/components/BottomTabBar.vue'
import { signedInUserSession } from '../support/session'

// tab 列只在登入之後看得到（#67 的全域路由保護）。少了這張 session，
// mountSuspended 的導覽會先被導去 /login，選中的 tab 就永遠是「都沒選中」。
mockNuxtImport('useUserSession', () => () => signedInUserSession())

const LABELS = ['首頁', '記錄', '趨勢', '生物', '保養']
const PATHS = ['/', '/log', '/trends', '/creatures', '/maintenance']

describe('BottomTabBar', () => {
  // Given 我開啟 App / When 畫面載入完成
  // Then 底部固定顯示五個 tab：首頁、記錄、趨勢、生物、保養，且「首頁」為選中狀態
  it('在首頁時渲染五個 tab，且「首頁」為選中狀態', async () => {
    const bar = await mountSuspended(BottomTabBar, { route: '/' })
    const links = bar.findAll('a')

    expect(links.map(link => link.text())).toEqual(LABELS)
    expect(links.map(link => link.attributes('href'))).toEqual(PATHS)
    expect(links.map(link => link.attributes('aria-current'))).toEqual([
      'page',
      undefined,
      undefined,
      undefined,
      undefined,
    ])
  })

  it('tab 列固定在畫面底部', async () => {
    const bar = await mountSuspended(BottomTabBar, { route: '/' })
    const nav = bar.get('nav')

    expect(nav.classes()).toContain('fixed')
    expect(nav.classes()).toContain('bottom-0')
  })

  // Given 我正在任一個 tab 頁面 / When 我點擊底部另一個 tab
  // Then 路由切換到該頁面，且該 tab 變為選中狀態（圖示與文字皆為主色系）
  it('切換到其他路由時，只有該 tab 為選中狀態', async () => {
    const bar = await mountSuspended(BottomTabBar, { route: '/trends' })
    const links = bar.findAll('a')

    expect(links.map(link => link.attributes('aria-current'))).toEqual([
      undefined,
      undefined,
      'page',
      undefined,
      undefined,
    ])
  })

  it('選中的 tab 其圖示與文字同在主色容器內，未選中的則為次要色', async () => {
    const bar = await mountSuspended(BottomTabBar, { route: '/trends' })
    const links = bar.findAll('a')
    const active = links[2]!
    const inactive = links[0]!

    // 主色掛在 <a> 上，圖示（UIcon）與文字都在其中，一起繼承 currentColor
    expect(active.classes()).toContain('text-primary')
    expect(active.html()).toContain('i-lucide:trending-up')
    expect(active.text()).toBe('趨勢')

    expect(inactive.classes()).not.toContain('text-primary')
    expect(inactive.classes()).toContain('text-dimmed')
  })

  // Given 我正在「生物詳情」這類子頁面 / When 畫面呈現
  // Then 底部 tab 列仍然存在，且「生物」tab 維持選中狀態
  it('在生物子頁面時「生物」tab 維持選中狀態', async () => {
    const bar = await mountSuspended(BottomTabBar, { route: '/creatures/demo-creature-id' })
    const links = bar.findAll('a')

    expect(links.map(link => link.attributes('aria-current'))).toEqual([
      undefined,
      undefined,
      undefined,
      'page',
      undefined,
    ])
  })

  it('首頁 tab 不會因為 / 是所有路徑的前綴而在子頁面被選中', async () => {
    const bar = await mountSuspended(BottomTabBar, { route: '/maintenance' })
    const links = bar.findAll('a')

    expect(links[0]!.attributes('aria-current')).toBeUndefined()
    expect(links[4]!.attributes('aria-current')).toBe('page')
  })

  // Given 我在行動裝置上瀏覽 / When 任一頁面渲染
  // Then 底部 tab 列位於安全區域（safe-area-inset-bottom）之上
  it('tab 列墊高至系統安全區域之上', async () => {
    const bar = await mountSuspended(BottomTabBar, { route: '/' })

    expect(bar.get('nav').classes()).toContain('pb-[env(safe-area-inset-bottom)]')
  })

  it('tab 列標示為導覽地標，供輔助技術辨識', async () => {
    const bar = await mountSuspended(BottomTabBar, { route: '/' })

    expect(bar.get('nav').attributes('aria-label')).toBe('主要導覽')
  })
})
