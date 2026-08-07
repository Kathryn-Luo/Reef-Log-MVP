import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import LoginPage from '../../../app/pages/login.vue'

// 登入畫面（issue #63，來源為 Epic #47 第 4 節的截圖 00a）。
//
// 這一頁「只有畫面」：兩顆按鈕指向的 /auth/google 與 /auth/guest 屬於
// `nuxt-auth-utils`，那個套件尚未安裝（CLAUDE.md：新增依賴需人類核准），
// 所以本輪只驗「入口長什麼樣、往哪裡去」，不驗按下去的結果。

enableAutoUnmount(afterEach)

const mountLogin = () => mountSuspended(LoginPage, { route: '/login' })

/** 截圖上兩顆按鈕的順序：Google 在上、訪客在下 */
const ACTIONS = ['login-action-google', 'login-action-guest']

/** 圖示在文字左側 ＝ 在按鈕的 HTML 裡先出現 */
function appearsBefore(html: string, first: string, second: string) {
  const firstAt = html.indexOf(first)
  const secondAt = html.indexOf(second)

  expect(firstAt).toBeGreaterThanOrEqual(0)
  expect(secondAt).toBeGreaterThanOrEqual(0)

  return firstAt < secondAt
}

// Given 我沒有登入 / When 我開啟 /login
// Then 我看到主標題「記錄你的海水缸」與兩行副標
// And  我看到「使用 Google 繼續」與「以訪客身分瀏覽」兩顆按鈕
describe('登入畫面 — 標題與副標', () => {
  it('主標題是「記錄你的海水缸」', async () => {
    const page = await mountLogin()

    expect(page.get('h1').text()).toBe('記錄你的海水缸')
  })

  it('副標兩行分別說明 App 的內容與登入的理由', async () => {
    const page = await mountLogin()
    const lead = page.get('[data-testid="login-lead"]')

    expect(lead.text()).toContain('水質、生物與保養，一站掌握。')
    expect(lead.text()).toContain('登入以在裝置間同步你的缸。')
    // 截圖上是分成兩行的，不是一整段折下來的
    expect(lead.html()).toContain('<br>')
  })

  it('兩顆按鈕的文案與截圖一致', async () => {
    const page = await mountLogin()

    expect(page.get('[data-testid="login-action-google"]').text()).toContain('使用 Google 繼續')
    expect(page.get('[data-testid="login-action-guest"]').text()).toContain('以訪客身分瀏覽')
  })
})

// Given 我在登入頁 / When 我檢視「使用 Google 繼續」按鈕
// Then 它是白底的主要按鈕、左側有 Google 的 G 圖示，且連向 /auth/google
describe('登入畫面 — Google 按鈕', () => {
  it('是白底的主要按鈕', async () => {
    const page = await mountLogin()
    const google = page.get('[data-testid="login-action-google"]')

    expect(google.attributes('data-emphasis')).toBe('primary')
    expect(google.classes()).toContain('bg-white')
  })

  it('左側有 Google 的四色 G 圖示', async () => {
    const page = await mountLogin()
    const google = page.get('[data-testid="login-action-google"]')

    // lucide 沒有品牌圖示，G 是內嵌的 svg；四色版才是 Google 認得的那一個
    const icon = google.get('[data-testid="login-google-icon"]')

    expect(icon.element.tagName.toLowerCase()).toBe('svg')
    expect(icon.html()).toContain('#4285F4')
    expect(appearsBefore(google.html(), 'login-google-icon', '使用 Google 繼續')).toBe(true)
  })

  it('連向 /auth/google，且是會整頁導出去的 <a>', async () => {
    const page = await mountLogin()
    const google = page.get('[data-testid="login-action-google"]')

    // OAuth 的起點是 server 路由不是前端路由，交給 vue-router 只會變成前端 404
    expect(google.element.tagName).toBe('A')
    expect(google.attributes('href')).toBe('/auth/google')
  })

  // /auth/ 底下全是「按下去就發生事情」的路由，尤其 /auth/guest 一次 GET 就建一位 User
  // 並複製一整份示範資料（#66）。這一頁是公開的，#67 之後每一次爬 `/` 都會落在這裡。
  //
  // 驗的是「渲染出來的 <a> 上真的有」而不是原始碼裡寫了——UButton 可能不把未知屬性
  // 往下傳，那樣寫了也等於沒寫。另一半（public/robots.txt）在 auth-wiring.test.ts。
  // 連同 noopener / noreferrer 一起驗：rel 是整個屬性被覆寫、不是合併，只寫 nofollow
  // 會把 UButton 對 external 連結自帶的那兩個值洗掉。這是實際踩過的——原始碼層級的
  // 比對看不到，只有讀渲染結果才看得見。
  it.each(['login-action-google', 'login-action-guest'])('%s 帶 rel="nofollow"，且沒洗掉 noopener / noreferrer', async (testid) => {
    const page = await mountLogin()
    const rel = page.get(`[data-testid="${testid}"]`).attributes('rel')?.split(/\s+/) ?? []

    expect(rel).toContain('nofollow')
    expect(rel).toContain('noopener')
    expect(rel).toContain('noreferrer')
  })
})

// Given 我在登入頁 / When 我檢視「以訪客身分瀏覽」按鈕
// Then 它是深底細邊框的次要按鈕、左側有人像圖示，且連向 /auth/guest
describe('登入畫面 — 訪客按鈕', () => {
  it('是深底細邊框的次要按鈕', async () => {
    const page = await mountLogin()
    const guest = page.get('[data-testid="login-action-guest"]')
    const classes = guest.classes()

    expect(guest.attributes('data-emphasis')).toBe('secondary')
    expect(classes).toContain('bg-elevated/40')
    expect(classes).toContain('border')
    expect(classes).toContain('border-default')
    expect(classes).not.toContain('bg-white')
  })

  it('左側有人像圖示', async () => {
    const page = await mountLogin()
    const guest = page.get('[data-testid="login-action-guest"]')

    expect(guest.get('[data-testid="login-guest-icon"]').classes()).toContain('i-lucide:user')
    expect(appearsBefore(guest.html(), 'login-guest-icon', '以訪客身分瀏覽')).toBe(true)
  })

  it('連向 /auth/guest，且是會整頁導出去的 <a>', async () => {
    const page = await mountLogin()
    const guest = page.get('[data-testid="login-action-guest"]')

    // 訪客 session 的建立同樣發生在 server 端
    expect(guest.element.tagName).toBe('A')
    expect(guest.attributes('href')).toBe('/auth/guest')
  })
})

// Given 我在登入頁 / When 我檢視頁面上方
// Then 我看到 App 圖示與文字標記「REEFLOG · 礁記」
describe('登入畫面 — 品牌標記', () => {
  it('顯示 App 圖示', async () => {
    const page = await mountLogin()
    const mark = page.get('[data-testid="login-app-mark"]')

    // 純裝飾，讀螢幕軟體不需要念它
    expect(mark.attributes('aria-hidden')).toBe('true')
  })

  it('顯示文字標記「REEFLOG · 礁記」', async () => {
    const page = await mountLogin()

    expect(page.get('[data-testid="login-brand"]').text()).toBe('REEFLOG · 礁記')
  })

  it('圖示與字標都在標題之上', async () => {
    const page = await mountLogin()
    const html = page.html()

    expect(appearsBefore(html, 'login-app-mark', 'login-brand')).toBe(true)
    expect(appearsBefore(html, 'login-brand', '記錄你的海水缸')).toBe(true)
  })
})

// Given 我在登入頁 / When 我檢視頁尾
// Then 我看到小字「繼續即代表你同意服務條款與隱私政策」，其中兩者為連結
describe('登入畫面 — 頁尾條款', () => {
  it('註明繼續即代表同意服務條款與隱私政策', async () => {
    const page = await mountLogin()

    expect(page.get('[data-testid="login-terms"]').text()).toBe('繼續即代表你同意服務條款與隱私政策')
  })

  it('「服務條款」與「隱私政策」各自是一個連結', async () => {
    const page = await mountLogin()
    const links = page.get('[data-testid="login-terms"]').findAll('a')

    expect(links.map(link => link.text())).toEqual(['服務條款', '隱私政策'])
    expect(links.map(link => link.attributes('href'))).toEqual(['/terms', '/privacy'])
  })
})

// Given 我在登入頁 / When 我檢視整個畫面
// Then 沒有第三種登入方式 And 不顯示底部導覽列
describe('登入畫面 — 版面', () => {
  it('只有 Google 與訪客兩種登入方式，順序與截圖一致', async () => {
    const page = await mountLogin()

    expect(
      page.findAll('[data-testid^="login-action-"]').map(action => action.attributes('data-testid')),
    ).toEqual(ACTIONS)
  })

  // 掛在頁面自己身上的 layout: false 才是「tab 列不出現」的真正原因；
  // 只 mount 這個元件的話 layout 本來就不會渲染，斷言不到任何東西
  it('不套用預設 layout，底部 tab 列因此不會出現', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/pages/login.vue'), 'utf8')

    expect(source).toMatch(/definePageMeta\(\{[^}]*layout:\s*false/)
  })

  it('沒有 layout 就自己撐滿視窗並套用深色主題', async () => {
    const page = await mountLogin()
    const screen = page.get('[data-testid="login-screen"]')

    expect(screen.classes()).toContain('min-h-dvh')
    expect(screen.classes()).toContain('dark')
  })
})

// issue #110：按下「以訪客身分瀏覽」之後，那顆按鈕要立刻看起來在跑。
//
// 這條路徑是整頁導向（<a>，不是 fetch），瀏覽器在等 302 的期間仍然停在這一頁上，
// 所以這個樣態是使用者這幾秒**唯一**看得到的回饋。#144 把示範資料的複製搬出登入請求
// 之後這一段短了很多（實測 14.8 秒 → 約 2.8 秒），但「按了沒反應」的問題與長度無關。
describe('登入畫面 — 訪客按鈕的處理中樣態', () => {
  it('按下之前不是處理中', async () => {
    const page = await mountLogin()

    expect(page.get('[data-testid="login-action-guest"]').attributes('data-starting')).toBe('false')
  })

  it('按下之後立刻進入處理中', async () => {
    const page = await mountLogin()
    const guest = page.get('[data-testid="login-action-guest"]')

    await guest.trigger('click')

    expect(guest.attributes('data-starting')).toBe('true')
  })

  // 連點兩下不能送出兩次登入：每一次 /auth/guest 都會建一位新訪客並複製一整份示範資料
  // （issue #66），第二次等於白白多一個沒人用的沙盒，還要再等一次那幾秒。
  //
  // 擋法是 preventDefault 而不是 disabled：這顆按鈕是連結，導向由瀏覽器處理。
  // 把它 disable 掉有機會連第一次那一次導向都一起取消，於是變成「按了完全沒事」。
  it('第一次點擊放行，之後的點擊被擋下來', async () => {
    const page = await mountLogin()
    const guest = page.get('[data-testid="login-action-guest"]')

    const first = new MouseEvent('click', { bubbles: true, cancelable: true })
    const second = new MouseEvent('click', { bubbles: true, cancelable: true })

    guest.element.dispatchEvent(first)
    await page.vm.$nextTick()
    guest.element.dispatchEvent(second)

    expect(first.defaultPrevented).toBe(false)
    expect(second.defaultPrevented).toBe(true)
  })

  // Google 那顆不受影響：兩顆共用一個旗標的話，按了訪客之後 Google 也會轉圈
  it('Google 按鈕不跟著進入處理中', async () => {
    const page = await mountLogin()

    await page.get('[data-testid="login-action-guest"]').trigger('click')

    expect(page.get('[data-testid="login-action-google"]').attributes('data-starting')).toBe('false')
  })
})
