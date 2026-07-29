import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import LoginPage from '../../../app/pages/login.vue'

// 登入畫面（issue #47 第 4 節，附截圖 screen-1）。
//
// 這一頁「只有畫面」。截圖上的兩顆按鈕各自要送去的 server 路由屬於 `nuxt-auth-utils`，
// 那個套件尚未安裝（CLAUDE.md：新增依賴需人類核准），所以本輪只把入口做出來，
// 按下去會落到還不存在的路由——理由與待辦寫在 PR 說明裡，不在這裡靠測試假裝它會動。
//
// 對應 issue 的敘述：「目前僅提供 Google 登入與訪客登入」。

enableAutoUnmount(afterEach)

const mountLogin = () => mountSuspended(LoginPage, { route: '/login' })

/** 截圖上兩顆按鈕的順序：Google 在上、訪客在下 */
const ACTIONS = ['login-action-google', 'login-action-guest']

describe('登入畫面 — 品牌與說明', () => {
  it('顯示 REEFLOG 字標與標題「記錄你的海水缸」', async () => {
    const page = await mountLogin()

    expect(page.get('[data-testid="login-brand"]').text()).toContain('REEFLOG')
    expect(page.get('h1').text()).toBe('記錄你的海水缸')
  })

  // 截圖的副標兩行：說明 App 做什麼，以及「為什麼要登入」
  it('副標說明 App 的內容與登入的理由', async () => {
    const page = await mountLogin()
    const lead = page.get('[data-testid="login-lead"]').text()

    expect(lead).toContain('水質、生物與保養')
    expect(lead).toContain('同步')
  })
})

describe('登入畫面 — 登入方式', () => {
  it('只提供 Google 與訪客兩種進入方式，順序與設計稿一致', async () => {
    const page = await mountLogin()

    expect(
      page.findAll('[data-testid^="login-action-"]').map(action => action.attributes('data-testid')),
    ).toEqual(ACTIONS)
  })

  it('Google 按鈕的文案與去向', async () => {
    const page = await mountLogin()
    const google = page.get('[data-testid="login-action-google"]')

    expect(google.text()).toContain('使用 Google 繼續')
    // OAuth 的起點是 server 路由，不是前端路由——必須整頁導出去，元素得是真的 <a>
    expect(google.element.tagName).toBe('A')
    expect(google.attributes('href')).toBe('/auth/google')
  })

  it('訪客按鈕的文案與去向', async () => {
    const page = await mountLogin()
    const guest = page.get('[data-testid="login-action-guest"]')

    expect(guest.text()).toContain('以訪客身分瀏覽')
    expect(guest.element.tagName).toBe('A')
    expect(guest.attributes('href')).toBe('/auth/guest')
  })

  // 截圖裡 Google 那顆是實心亮色、訪客那顆是深底外框——主要動作只有一個
  it('Google 是主要動作，訪客是次要動作', async () => {
    const page = await mountLogin()

    expect(page.get('[data-testid="login-action-google"]').attributes('data-emphasis')).toBe('primary')
    expect(page.get('[data-testid="login-action-guest"]').attributes('data-emphasis')).toBe('secondary')
  })
})

describe('登入畫面 — 頁尾', () => {
  // 截圖最下方一行小字
  it('註明繼續即代表同意服務條款與隱私政策', async () => {
    const page = await mountLogin()
    const terms = page.get('[data-testid="login-terms"]').text()

    expect(terms).toContain('繼續即代表你同意')
    expect(terms).toContain('服務條款')
    expect(terms).toContain('隱私政策')
  })
})

describe('登入畫面 — 版面', () => {
  // 截圖裡沒有底部 tab 列：還沒登入的人沒有缸可看，那五個 tab 全部按了也沒有意義
  it('不套用預設 layout，底部 tab 列因此不會出現', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/pages/login.vue'), 'utf8')

    expect(source).toMatch(/definePageMeta\(\{[^}]*layout:\s*false/)
  })

  // 沒有 layout 就沒有人提供深色外框與滿版高度，這一頁得自己來
  it('自己撐滿視窗並套用深色主題', async () => {
    const page = await mountLogin()
    const screen = page.get('[data-testid="login-screen"]')

    expect(screen.classes()).toContain('min-h-dvh')
    expect(screen.classes()).toContain('dark')
  })
})
