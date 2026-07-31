import { describe, expect, it } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import DefaultLayout from '../../../app/layouts/default.vue'
import { signedInUserSession } from '../support/session'

// 這個 layout 只在登入之後看得到（#67 的全域路由保護）。少了這張 session，
// mountSuspended 的導覽會先被導去 /login，選中的 tab 就對不上。
mockNuxtImport('useUserSession', () => () => signedInUserSession())

const slots = { default: () => '頁面內容' }

describe('default layout', () => {
  // Given 我開啟 App / When 畫面載入完成
  // Then 底部固定顯示五個 tab，且「首頁」為選中狀態
  it('頁面內容之外一併渲染底部 tab 列', async () => {
    const layout = await mountSuspended(DefaultLayout, { route: '/', slots })

    expect(layout.text()).toContain('頁面內容')

    const links = layout.get('nav').findAll('a')
    expect(links.map(link => link.text())).toEqual(['首頁', '記錄', '趨勢', '生物', '保養'])
    expect(links[0]!.attributes('aria-current')).toBe('page')
  })

  // Given 我正在「生物詳情」這類子頁面 / When 畫面呈現
  // Then 底部 tab 列仍然存在，且「生物」tab 維持選中狀態
  it('在生物子頁面仍保留 tab 列，且「生物」維持選中', async () => {
    const layout = await mountSuspended(DefaultLayout, {
      route: '/creatures/demo-creature-id',
      slots,
    })

    const links = layout.get('nav').findAll('a')
    expect(links).toHaveLength(5)
    expect(links[3]!.attributes('aria-current')).toBe('page')
  })

  // Given 我在行動裝置上瀏覽 / When 任一頁面渲染
  // Then 全站套用深色主題
  it('整個 App 外框套用深色主題', async () => {
    const layout = await mountSuspended(DefaultLayout, { route: '/', slots })
    const root = layout.get('[data-app-shell]')

    expect(root.classes()).toContain('dark')
    expect(root.classes()).toContain('bg-default')
  })

  it('內容區預留底部 tab 列的高度，不被蓋住', async () => {
    const layout = await mountSuspended(DefaultLayout, { route: '/', slots })
    const main = layout.get('main')

    expect(main.classes().some(name => name.startsWith('pb-'))).toBe(true)
  })
})
