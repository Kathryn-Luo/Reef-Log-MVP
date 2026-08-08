import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import type { Component } from 'vue'
import HomePage from '../../../app/pages/index.vue'
import LogPage from '../../../app/pages/log.vue'
import TrendsPage from '../../../app/pages/trends.vue'
import CreaturesPage from '../../../app/pages/creatures/index.vue'
import MaintenancePage from '../../../app/pages/maintenance.vue'
import NewTankPage from '../../../app/pages/tanks/new.vue'
import { signedInUserSession } from '../support/session'
import { PROTECTED_PAGES } from '../../e2e/support/protectedPages'
import type { TankOption, WaterParameterKey } from '#shared/types/home'
import type { MaintenanceTaskDto } from '#shared/types/maintenance'
import type { TrendPageData } from '#shared/types/trend'
import { addDays, toLocalDateOnly } from '#shared/utils/maintenance'
import { DEFAULT_WATER_TARGETS, WATER_PARAMETER_ORDER } from '#shared/utils/waterQuality'

// issue #146 的第二條驗收條件，在 unit 這一側的證明：
//
//   Given 該頁在登入狀態下會整頁壞掉（模擬 500）
//   When  跑這組 test
//   Then  test 轉紅
//
// auth-guard.spec.ts 的「已登入開 <path> 停在原地」改成先等 PROTECTED_PAGES 上那個
// 標記出現。這支測試驗的是那張表的前提：**每一個標記都只在該頁載入成功時存在**。
// 少了它，表上有人塞一個「三態共用的常駐頁首」（例如 trends-subtitle）進來，
// E2E 那組 test 會安靜地退回原本的問題——整頁壞掉照樣是綠的，而且要等到有人真的
// 把某一頁打壞才會發現。
//
// E2E 本體跑在 Vercel preview 上（#23），不在 TDD Develop 的 job 內執行。
// 所以這裡不模擬瀏覽器，直接把頁面元件掛起來，把它要的 API 全部打成 500——
// 那正是「整頁壞掉」在這幾頁上的樣子（#132 之後畫成 LoadErrorState）。

mockNuxtImport('useUserSession', () => () => signedInUserSession())

// happy-dom 不做版面計算，容器量出來是 0×0，/trends 上的 echarts 會判定「沒有尺寸」
// 而整張圖不畫（理由與 tests/unit/pages/trends.test.ts 相同）。
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 })
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 300 })

const MAIN_TANK: TankOption = {
  id: 'tank-1',
  name: '主缸',
  sizeSpec: '4 尺',
  volumeLiters: 420,
  setupType: 'SPS MIXED',
  colorHex: '#2dd4bf',
}

const TODAY = toLocalDateOnly(new Date())

/**
 * 一個今天到期的保養任務。
 *
 * 「今天該做」那一區要有東西才會渲染（兩區都空時畫的是 maintenance-empty），
 * 而 `today-section` 正是 /maintenance 在表上的標記。日期由今天往回推，
 * 寫死的話同一份程式碼會在某一天自己紅掉（PR #138 的教訓）。
 */
function dueTodayTask(): MaintenanceTaskDto {
  return {
    id: 'task-water',
    name: '換水 10%',
    intervalDays: 7,
    startOn: addDays(TODAY, -7),
    createdOn: addDays(TODAY, -90),
    displayOrder: 0,
    lastCompletion: null,
  }
}

/** 六個測項一定都在，沒有讀值的那一項是空序列而不是缺席（見 shared/types/trend.ts） */
function emptyTrends(): TrendPageData {
  return {
    range: '30d',
    series: WATER_PARAMETER_ORDER.map((parameter: WaterParameterKey) => ({
      parameter,
      points: [],
      latest: null,
      average: null,
      highest: null,
      lowest: null,
      change: null,
      target: { parameter, ...DEFAULT_WATER_TARGETS[parameter] },
    })),
  }
}

/** 這一輪的每一支 GET 都回 500 —— 也就是「整頁壞掉」 */
const state = { failing: false }

/** 說不出原因的失敗（500 / 離線 / function 掛掉） */
function serverError() {
  return createError({ statusCode: 500, statusMessage: 'Internal Server Error' })
}

/** 成功時回 `body`，`state.failing` 時 500 */
function endpoint(path: string, body: () => unknown) {
  registerEndpoint(path, () => {
    if (state.failing) {
      throw serverError()
    }

    return body()
  })
}

// 訪客沙盒的補建（#144）。缸清單非空時不會被呼叫，註冊它是為了「拿到空清單」
// 那條路徑不會停在「正在為你準備示範資料」上。
registerEndpoint('/api/guest-sandbox', {
  method: 'POST',
  handler: () => ({ copied: 0, alreadySeeded: true }),
})

endpoint('/api/tanks', () => ({ tanks: [MAIN_TANK] }))
endpoint('/api/tanks/tank-1/home', () => ({ water: null, creatures: [] }))
endpoint('/api/tanks/tank-1/water-logs', () => ({ previousReadings: [], waterLogs: [] }))
endpoint('/api/tanks/tank-1/trends', () => emptyTrends())
endpoint('/api/tanks/tank-1/creatures', () => ({ creatures: [] }))
endpoint('/api/tanks/tank-1/maintenance', () => ({ tasks: [dueTodayTask()] }))

const PAGE_COMPONENTS: Record<string, Component> = {
  '/': HomePage,
  '/log': LogPage,
  '/trends': TrendsPage,
  '/creatures': CreaturesPage,
  '/maintenance': MaintenancePage,
  '/tanks/new': NewTankPage,
}

/** 沒有任何 GET 的頁面：整頁壞掉不是靠打壞 API 模擬得出來的 */
const STATIC_PAGES = ['/tanks/new']

enableAutoUnmount(afterEach)

beforeEach(() => {
  // useAsyncData 的結果會留在 payload 上，測試之間必須清掉才不會拿到上一題的資料
  clearNuxtData()
  // 沙盒的狀態 #144 之後住在 useState（跨頁共用），不歸 clearNuxtData 管
  clearNuxtState()

  state.failing = false
})

/**
 * 掛起某一頁，等它自己那串請求落地。
 *
 * 這幾頁的載入都是兩段串起來的（先問有哪些缸，再問那個缸的內容），
 * 加上 #144 那一問，所以要多 flush 幾輪。
 */
async function open(path: string) {
  const page = await mountSuspended(PAGE_COMPONENTS[path]!, { route: path })

  await flushPromises()
  await flushPromises()
  await flushPromises()

  return page
}

// Given 我已登入 / When 我開啟受保護的頁面 / Then 該頁自己的正面標記出現
describe('每一頁載入成功時，表上的標記真的畫得出來', () => {
  it.each(PROTECTED_PAGES)('$path 上看得到 $marker', async ({ path, marker }) => {
    const page = await open(path)

    expect(page.find(`[data-testid="${marker}"]`).exists()).toBe(true)
  })
})

// Given 該頁在登入狀態下會整頁壞掉（模擬 500）
// When  跑這組 test（＝等那個標記出現）
// Then  test 轉紅
describe('每一頁整頁壞掉時，表上的標記不會出現', () => {
  const dataPages = PROTECTED_PAGES.filter(page => !STATIC_PAGES.includes(page.path))

  it.each(dataPages)('$path 的 API 全部 500 時，$marker 不存在', async ({ path, marker }) => {
    state.failing = true

    const page = await open(path)

    expect(page.find(`[data-testid="${marker}"]`).exists()).toBe(false)
    // 而且是真的畫成「載入失敗」，不是碰巧什麼都沒渲染出來
    expect(page.find('[data-testid="load-error"]').exists()).toBe(true)
  })

  // STATIC_PAGES（目前只有 /tanks/new）不在這一組裡：它沒有任何 GET，打不壞，
  // 而它的標記就是表單本身——頁面畫得出來才有。那件事上面那組已經驗過了，
  // 在這裡再寫一次只是換個 describe 重複斷言同一件事。
  // render 期的例外一樣會讓 tank-form 消失，只是在 unit 這一側模擬不出來。
})

// #146 的成因不留成 test，因為在這個掛載方式下它證明不了任何事：
// 這支測試掛的是頁面元件本身，不是 <NuxtPage>，而 login-screen 只住在
// app/pages/login.vue。「壞掉時 login-screen 不存在」在這裡是任何實作、任何狀態下
// 都成立的——它量到的不是「舊判準沒有鑑別力」，只是「我沒有掛登入頁」。
// 恆綠的斷言在本專案是禁止的（CLAUDE.md），所以那一組拿掉了。
//
// 「舊判準在真的瀏覽器裡同樣恆成立」只有 E2E 驗得到，而那正是 auth-guard.spec.ts
// 現在先等正面標記的理由——寫在那支 spec 的註解裡。
