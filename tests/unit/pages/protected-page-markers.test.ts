import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import type { Component } from 'vue'
import HomePage from '../../../app/pages/index.vue'
import LogPage from '../../../app/pages/log.vue'
import TrendsPage from '../../../app/pages/trends.vue'
import CreaturesPage from '../../../app/pages/creatures/index.vue'
import NewCreaturePage from '../../../app/pages/creatures/new.vue'
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
// 標記出現（成因寫在 tests/e2e/support/protectedPages.ts）。這支測試驗的是那張表的
// 前提：**每一個標記都只在該頁載入成功時存在**。少了它，表上有人塞一個「三態共用的
// 常駐頁首」（例如 trends-subtitle）進來，E2E 那組 test 會安靜地退回原本的問題
// ——整頁壞掉照樣是綠的，而且要等到有人真的把某一頁打壞才會發現。
//
// 這裡是那張表唯一繞不過去的守門：auth-guard-spec.test.ts 那兩條命名黑名單只是
// 早期警示，`water-log-subtitle` 之類沒被列進去的常駐頁首照樣走得過。
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
 * `today-section` 是 /maintenance 在表上的標記，它落在 `v-else-if="isEmpty"` 的
 * 後面那一支——**「今天該做」與「即將到期」兩區都空的時候才不渲染**（那時畫的是
 * maintenance-empty）。區內今天沒事時仍會渲染，只是內容換成 today-empty。
 * 所以這裡給一個任務就夠，不必刻意讓它落在「今天」。
 *
 * 日期由今天往回推，寫死的話同一份程式碼會在某一天自己紅掉（PR #138 的教訓）。
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
  '/creatures/new': NewCreaturePage,
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

const MARKER_BY_PATH = new Map(PROTECTED_PAGES.map(page => [page.path, page.marker]))

/** flush 幾輪就放棄。夠寬到容得下日後多串一段請求，又不會在真的卡住時空轉 */
const MAX_SETTLE_ROUNDS = 10

/**
 * 掛起某一頁，等它自己那串請求落地。
 *
 * 這幾頁的載入是兩段串起來的（先問有哪些缸，再問那個缸的內容），加上 #144 沙盒那一問，
 * 所以要 flush 好幾輪。但**不能寫死次數**：實際要幾輪取決於該頁串了幾段，日後任一頁
 * 多串一段（像 #144 那樣），標記就會因為「還沒載完」而不在——而這支測試要證明的是
 * 「因為壞掉所以不在」。兩者在斷言上長得一模一樣，證明會安靜地變成假的。
 * （寫死 3 次的時候實測 2 次就夠、1 次會紅，餘裕只有一輪。）
 *
 * 所以等到這一頁自己講話為止：成功就畫出它的標記，失敗就畫出 load-error（#132）。
 * 兩者都沒有＝這一頁還在半路上，那時候不管斷言什麼都沒有意義，直接讓它紅在這裡，
 * 錯誤訊息也會直接說是哪一頁沒落地。
 */
async function open(path: string) {
  const page = await mountSuspended(PAGE_COMPONENTS[path]!, { route: path })
  const marker = MARKER_BY_PATH.get(path)!

  const settled = () =>
    page.find(`[data-testid="${marker}"]`).exists()
    || page.find('[data-testid="load-error"]').exists()

  for (let round = 0; round < MAX_SETTLE_ROUNDS && !settled(); round += 1) {
    await flushPromises()
  }

  expect(settled(), `${path} flush ${MAX_SETTLE_ROUNDS} 輪之後既沒畫出 ${marker} 也沒畫出 load-error`)
    .toBe(true)

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

  // 「而且是真的畫成載入失敗，不是碰巧什麼都沒渲染出來」這件事不在這裡斷言，
  // 而是由 open() 的等待條件保證：它等到 marker 或 load-error 其中一個出現才回來，
  // 都沒有就自己紅。所以標記不在的時候，畫面上一定是 load-error。
  // 在這裡再斷言一次的話，那句話會恆為真——open() 已經把它證完了。
  it.each(dataPages)('$path 的 API 全部 500 時，$marker 不存在', async ({ path, marker }) => {
    state.failing = true

    const page = await open(path)

    expect(page.find(`[data-testid="${marker}"]`).exists()).toBe(false)
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
