import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import LogPage from '../../../app/pages/log.vue'
import { signedInUserSession } from '../support/session'
import type { TankOption, WaterParameterKey, WaterReadingDto } from '#shared/types/home'
import type { WaterLogDto } from '#shared/types/waterLog'
import { parseWaterLogInput } from '#shared/utils/waterLog'

// 記錄水質頁（screen-3，issue #124 ＝ #11 的畫面那一半）。
//
// 資料那一半（GET / POST /api/tanks/:id/water-logs）已由 PR #127 合併進 main，
// 這裡把那份契約當成夾具的形狀，驗畫面有沒有照著串。
//
// 這一頁要登入才進得去（#67 的全域路由保護）。少了這張 session，
// mountSuspended 的導覽會先被導去 /login。
mockNuxtImport('useUserSession', () => () => signedInUserSession())

const MAIN_TANK: TankOption = {
  id: 'tank-1',
  name: '主缸',
  sizeSpec: '4 尺',
  volumeLiters: 420,
  setupType: 'SPS MIXED',
  colorHex: '#2dd4bf',
}

const DAY = 24 * 60 * 60 * 1000

// 相對時間是「相對現在」的推算值，固定日期會隨著時間漂移，所以夾具由現在往回推。
// 「4 天前」這種確切的文字由 tests/unit/shared/water-log-form.test.ts 用固定的 now 驗，
// 這裡只認得出「有一段相對時間」與列的先後。
function log(id: string, daysAgo: number, readings: WaterReadingDto[]): WaterLogDto {
  return { id, measuredAt: new Date(Date.now() - daysAgo * DAY).toISOString(), readings }
}

const PREVIOUS_READINGS: WaterReadingDto[] = [
  { parameter: 'KH', value: 8 },
  { parameter: 'CA', value: 415 },
  { parameter: 'MG', value: 1240 },
  { parameter: 'NO3', value: 12 },
  { parameter: 'PO4', value: 0.04 },
  { parameter: 'SALINITY', value: 1.026 },
]

const WATER_LOGS: WaterLogDto[] = [
  log('log-1', 4, [{ parameter: 'KH', value: 8 }, { parameter: 'CA', value: 415 }, { parameter: 'MG', value: 1240 }]),
  log('log-2', 8, [{ parameter: 'KH', value: 8.1 }, { parameter: 'CA', value: 418 }, { parameter: 'MG', value: 1250 }]),
  log('log-3', 12, [{ parameter: 'KH', value: 7.9 }, { parameter: 'CA', value: 410 }, { parameter: 'MG', value: 1230 }]),
]

/** 把某支 API 的回應停在半路，用來驗「資料還在路上」的樣態 */
function gate() {
  let open!: () => void
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })

  return { promise, open }
}

const state = {
  tanks: [] as TankOption[],
  previousReadings: [] as WaterReadingDto[],
  waterLogs: [] as WaterLogDto[],
  hold: { get: null as ReturnType<typeof gate> | null, post: null as ReturnType<typeof gate> | null },
  // issue #132：兩支 GET 各自可以被打成 500，用來分辨「拿不到資料」與「你沒有資料」
  fail: { tanks: false, get: false },
  post: {
    calls: 0,
    body: null as { measuredAt?: string, readings?: Record<string, unknown> } | null,
    fail: false,
    failure: { statusCode: 400, statusMessage: 'Invalid water log input', message: null as string | null },
  },
}

/**
 * registerEndpoint 底下跑的是 h3 的 node listener，$fetch 送出的 body
 * 原樣掛在 node 請求物件上（node-mock-http 的行為）。
 */
interface MockNodeEvent {
  node: { req: { body?: string } }
}

/** 說不出原因的失敗（500 / 離線 / function 掛掉），沒有可以直接顯示給使用者的訊息 */
function serverError() {
  return createError({ statusCode: 500, statusMessage: 'Internal Server Error' })
}

registerEndpoint('/api/tanks', () => {
  if (state.fail.tanks) {
    throw serverError()
  }

  return { tanks: state.tanks }
})

registerEndpoint('/api/tanks/tank-1/water-logs', {
  method: 'GET',
  handler: async () => {
    await state.hold.get?.promise

    if (state.fail.get) {
      throw serverError()
    }

    return { previousReadings: state.previousReadings, waterLogs: state.waterLogs }
  },
})

registerEndpoint('/api/tanks/tank-1/water-logs', {
  method: 'POST',
  handler: async (event) => {
    state.post.calls += 1
    state.post.body = JSON.parse((event as unknown as MockNodeEvent).node.req.body ?? 'null')

    await state.hold.post?.promise

    if (state.post.fail) {
      // 與 server/api/tanks/[id]/water-logs.post.ts 同一個形狀：statusMessage 只留 ASCII，
      // 可以給使用者看的中文訊息放在 data.message
      throw createError({
        statusCode: state.post.failure.statusCode,
        statusMessage: state.post.failure.statusMessage,
        data: state.post.failure.message === null ? undefined : { message: state.post.failure.message },
      })
    }

    // API 回傳剛寫進去的那一筆（含 id 與正規化後的 measuredAt），
    // 畫面因此不必為了讓它出現在歷史最上方而整包重抓
    return {
      waterLog: {
        id: 'log-new',
        measuredAt: state.post.body?.measuredAt,
        readings: Object.entries(state.post.body?.readings ?? {}).map(([parameter, value]) => ({
          parameter: parameter as WaterParameterKey,
          value: Number(value),
        })),
      },
    }
  },
})

enableAutoUnmount(afterEach)

beforeEach(() => {
  // useAsyncData 的結果會留在 payload 上，測試之間必須清掉才不會拿到上一題的資料
  clearNuxtData()

  state.tanks = [MAIN_TANK]
  state.previousReadings = PREVIOUS_READINGS
  state.waterLogs = WATER_LOGS
  state.hold = { get: null, post: null }
  state.fail = { tanks: false, get: false }
  state.post.calls = 0
  state.post.body = null
  state.post.fail = false
  state.post.failure = { statusCode: 400, statusMessage: 'Invalid water log input', message: null }
})

type Page = Awaited<ReturnType<typeof mountSuspended>>

/**
 * 這一頁的載入是兩段串起來的（先問有哪些缸，再問那個缸的水質記錄），
 * 所以要 flush 兩輪才輪得到第二段的回應。
 */
async function settle() {
  await flushPromises()
  await flushPromises()
}

async function open() {
  const page = await mountSuspended(LogPage, { route: '/log' })

  await settle()

  return page
}

function reading(page: Page, parameter: WaterParameterKey) {
  return page.get(`[data-testid="reading-field"][data-parameter="${parameter}"]`)
}

async function fill(page: Page, values: Partial<Record<WaterParameterKey, string>>) {
  for (const [parameter, value] of Object.entries(values)) {
    await page.get(`input[name="${parameter}"]`).setValue(value)
  }
}

async function submit(page: Page) {
  await page.get('[data-testid="water-log-submit"]').trigger('click')
  await settle()
}

function historyIds(page: Page) {
  return page.findAll('[data-testid="history-row"]').map(row => row.attributes('data-log-id'))
}

describe('記錄水質 — 頁首', () => {
  // Given 我進入「記錄水質」頁 / When 畫面載入
  // Then 頁首顯示「記錄水質」與副標「<缸名> · <尺寸>」，左上角有 ← 返回
  it('顯示標題與「<缸名> · <尺寸>」副標', async () => {
    const page = await open()

    expect(page.get('h1').text()).toBe('記錄水質')
    expect(page.get('[data-testid="water-log-subtitle"]').text()).toBe('主缸 · 4 尺')
  })

  it('沒有填尺寸的缸，副標只有缸名', async () => {
    state.tanks = [{ ...MAIN_TANK, sizeSpec: null }]

    const page = await open()

    expect(page.get('[data-testid="water-log-subtitle"]').text()).toBe('主缸')
  })

  // 返回的是「上一頁」而不是寫死回首頁：從趨勢頁點進來的話回首頁是錯的
  it('左上角的 ← 返回上一頁，不是寫死的連結', async () => {
    const page = await open()
    const back = page.get('[data-testid="water-log-back"]')

    expect(back.attributes('aria-label')).toBe('返回上一頁')
    expect(back.element.tagName).toBe('BUTTON')
    expect(back.attributes('href')).toBeUndefined()

    const spy = vi.spyOn(page.vm.$router, 'back').mockImplementation(() => {})
    await back.trigger('click')

    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  // And 日期欄預設為今天、時間欄預設為現在
  it('日期欄預設今天、時間欄預設現在', async () => {
    const page = await open()

    const date = (page.get('input[name="measuredDate"]').element as HTMLInputElement).value
    const time = (page.get('input[name="measuredTime"]').element as HTMLInputElement).value

    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(time).toMatch(/^\d{2}:\d{2}$/)
    // 兩欄合起來就是「現在」。不帶 offset 的字串會被當成當地時間解析，
    // 與 Date.now() 相比因此不受 runner 的時區影響。
    expect(Math.abs(new Date(`${date}T${time}`).getTime() - Date.now())).toBeLessThan(60_000)
  })
})

describe('記錄水質 — 六個元素輸入欄', () => {
  // Then 顯示六個元素輸入欄，依序為 KH / Ca / Mg / NO₃ / PO₄ / 鹽度
  it('六欄依序排列', async () => {
    const page = await open()

    expect(page.findAll('[data-testid="reading-field"]').map(field => field.attributes('data-parameter')))
      .toEqual(['KH', 'CA', 'MG', 'NO3', 'PO4', 'SALINITY'])
    expect(page.findAll('[data-testid="reading-label"]').map(label => label.text()))
      .toEqual(['KH', 'Ca', 'Mg', 'NO₃', 'PO₄', '鹽度'])
  })

  // And 每欄右側顯示單位（dKH / ppm / ppm / ppm / ppm / SG）與「上次 <值>」
  it('每欄右側顯示單位與「上次 <值>」', async () => {
    const page = await open()

    expect(page.findAll('[data-testid="reading-unit"]').map(unit => unit.text()))
      .toEqual(['dKH', 'ppm', 'ppm', 'ppm', 'ppm', 'SG'])
    expect(page.findAll('[data-testid="reading-previous"]').map(previous => previous.text()))
      .toEqual(['上次 8.0', '上次 415', '上次 1240', '上次 12', '上次 .04', '上次 1.026'])
  })

  // And 「上次」取的是該缸該測項最近一筆已存在的讀值 ——
  // 也就是 previousReadings，而不是從有筆數上限的歷史清單推導
  it('「上次」讀的是 previousReadings，不是歷史清單', async () => {
    // 歷史裡的 KH 是 8.0，前次讀值另外給 7.2：兩者不同才分得出畫面讀的是哪一份
    state.previousReadings = [{ parameter: 'KH', value: 7.2 }]

    const page = await open()

    expect(reading(page, 'KH').get('[data-testid="reading-previous"]').text()).toBe('上次 7.2')
  })

  // Given 該缸該測項從未被記錄過 / When 該欄渲染
  // Then 右側不顯示「上次」，只顯示單位
  it('從未被記錄過的測項不顯示「上次」，單位仍在', async () => {
    state.previousReadings = [{ parameter: 'KH', value: 8 }]

    const page = await open()

    expect(page.findAll('[data-testid="reading-previous"]')).toHaveLength(1)
    for (const parameter of ['CA', 'MG', 'NO3', 'PO4', 'SALINITY'] as const) {
      expect(reading(page, parameter).find('[data-testid="reading-previous"]').exists()).toBe(false)
      expect(reading(page, parameter).get('[data-testid="reading-unit"]').text()).not.toBe('')
    }
  })

  // 讀值欄用 inputmode="decimal" 而不是 type="number"：
  // 上下箭頭與滾輪會誤觸，各家瀏覽器對非法輸入的處理也不一致
  it('讀值欄叫得出數字鍵盤，但不是 type="number"', async () => {
    const page = await open()

    for (const parameter of ['KH', 'CA', 'MG', 'NO3', 'PO4', 'SALINITY'] as const) {
      const input = page.get(`input[name="${parameter}"]`)

      expect(input.attributes('inputmode')).toBe('decimal')
      expect(input.attributes('type')).not.toBe('number')
    }
  })
})

describe('記錄水質 — 儲存', () => {
  // Given 我只填了 KH、Ca、Mg，NO₃ / PO₄ / 鹽度留空
  // When 我點擊「儲存這筆記錄」
  // Then 建立一筆量測記錄，其下只包含 KH / Ca / Mg 三筆讀值，未填的三項不建立任何列
  it('只把填了的測項送出，未填的不出現在請求裡', async () => {
    const page = await open()

    await fill(page, { KH: '7.8', CA: '412', MG: '1180' })
    await submit(page)

    expect(state.post.calls).toBe(1)
    expect(state.post.body?.readings).toEqual({ KH: '7.8', CA: '412', MG: '1180' })
  })

  // measuredAt 一定要帶 offset：畫面上的是牆上時間，server 存的是量測瞬間
  it('送出的 measuredAt 帶著 offset，過得了 server 的解析', async () => {
    const page = await open()

    await fill(page, { KH: '7.8' })
    await submit(page)

    const measuredAt = state.post.body?.measuredAt

    expect(measuredAt).toMatch(/(Z|[+-]\d{2}:\d{2})$/)
    expect(parseWaterLogInput({ measuredAt, readings: { KH: '7.8' } }).ok).toBe(true)
  })

  // And 歷史記錄列表最上方出現這筆新記錄
  it('新記錄出現在歷史最上方', async () => {
    const page = await open()

    await fill(page, { KH: '7.8', CA: '412', MG: '1180' })
    await submit(page)

    expect(historyIds(page)).toEqual(['log-new', 'log-1', 'log-2', 'log-3'])
    expect(page.findAll('[data-testid="history-row"]')[0]!.get('[data-testid="history-summary"]').text())
      .toBe('KH 7.8 · Ca 412 · Mg 1180')
  })

  // 成功不跳頁、不彈 toast：輸入區與歷史區在同一頁，最好的證據就是它出現在下面。
  // 輸入欄清空，日期時間欄重設為「現在」。
  it('成功後輸入欄清空', async () => {
    const page = await open()

    await fill(page, { KH: '7.8', CA: '412' })
    await submit(page)

    expect((page.get('input[name="KH"]').element as HTMLInputElement).value).toBe('')
    expect((page.get('input[name="CA"]').element as HTMLInputElement).value).toBe('')
  })

  // 剛存下的值就是下一次的「上次」；沒填的那幾項維持原本的前次讀值
  it('成功後「上次」換成剛存下的值', async () => {
    const page = await open()

    await fill(page, { KH: '7.8' })
    await submit(page)

    expect(reading(page, 'KH').get('[data-testid="reading-previous"]').text()).toBe('上次 7.8')
    expect(reading(page, 'CA').get('[data-testid="reading-previous"]').text()).toBe('上次 415')
  })

  // 按鈕 disabled + 進行中，避免連點送出兩筆
  it('儲存中按鈕按不動', async () => {
    state.hold.post = gate()

    const page = await open()

    await fill(page, { KH: '7.8' })
    await page.get('[data-testid="water-log-submit"]').trigger('click')
    await settle()

    expect(page.get('[data-testid="water-log-submit"]').attributes('disabled')).toBeDefined()

    state.hold.post.open()
    await settle()

    expect(page.get('[data-testid="water-log-submit"]').attributes('disabled')).toBeUndefined()
    expect(state.post.calls).toBe(1)
  })

  // Given 我六項全部留空 / When 我點擊「儲存這筆記錄」
  // Then 顯示錯誤提示「至少填寫一項讀值」，不建立任何記錄
  it('六項全空時顯示「至少填寫一項讀值」，不送出', async () => {
    const page = await open()

    await submit(page)

    expect(state.post.calls).toBe(0)
    expect(page.get('[data-testid="water-log-error"]').text()).toContain('至少填寫一項讀值')
    expect(historyIds(page)).toEqual(['log-1', 'log-2', 'log-3'])
  })
})

describe('記錄水質 — 欄位驗證', () => {
  // Given 我在 KH 欄輸入非數字或負數 / When 欄位失焦
  // Then 顯示該欄的驗證錯誤
  it.each([['abc'], ['-1'], ['1.12345']])('KH 欄輸入 %s 後失焦，該欄顯示驗證錯誤', async (value) => {
    const page = await open()

    await fill(page, { KH: value })
    await page.get('input[name="KH"]').trigger('blur')

    expect(reading(page, 'KH').get('[data-testid="reading-error"]').text()).not.toBe('')
  })

  // 輸入中不打斷：還沒失焦就先跳錯誤，等於在使用者打到一半時說他打錯了
  it('輸入中還沒失焦時不顯示錯誤', async () => {
    const page = await open()

    await fill(page, { KH: 'abc' })

    expect(reading(page, 'KH').find('[data-testid="reading-error"]').exists()).toBe(false)
  })

  it('改成合法的值並失焦後，該欄的錯誤消失', async () => {
    const page = await open()

    await fill(page, { KH: '-1' })
    await page.get('input[name="KH"]').trigger('blur')
    await fill(page, { KH: '7.8' })
    await page.get('input[name="KH"]').trigger('blur')

    expect(reading(page, 'KH').find('[data-testid="reading-error"]').exists()).toBe(false)
  })

  // And 儲存被阻擋 —— 連失焦都沒發生就直接按儲存，一樣要擋下來
  it('欄位有非法值時儲存被阻擋，也不送出請求', async () => {
    const page = await open()

    await fill(page, { KH: '-1', CA: '412' })
    await submit(page)

    expect(state.post.calls).toBe(0)
    expect(reading(page, 'KH').get('[data-testid="reading-error"]').text()).not.toBe('')
    expect(page.get('[data-testid="water-log-error"]').exists()).toBe(true)
  })
})

describe('記錄水質 — 歷史記錄', () => {
  // Given 該缸已有三筆記錄 / When 我瀏覽頁面下方的「歷史記錄」
  // Then 依量測時間新到舊列出，每列顯示「MM / DD · HH:mm」、三項摘要與相對時間
  it('依量測時間新到舊列出', async () => {
    const page = await open()

    expect(historyIds(page)).toEqual(['log-1', 'log-2', 'log-3'])
  })

  it('每列有「MM / DD · HH:mm」、KH / Ca / Mg 摘要與相對時間', async () => {
    const page = await open()
    const row = page.findAll('[data-testid="history-row"]')[0]!

    expect(row.get('[data-testid="history-time"]').text()).toMatch(/^\d{2} \/ \d{2} · \d{2}:\d{2}$/)
    expect(row.get('[data-testid="history-summary"]').text()).toBe('KH 8.0 · Ca 415 · Mg 1240')
    expect(row.get('[data-testid="history-ago"]').text()).toMatch(/天前$/)
  })

  // Given 該缸完全沒有水質記錄 / When 我瀏覽「歷史記錄」
  // Then 顯示空狀態文案，而非空白區塊
  it('沒有任何記錄時顯示空狀態文案', async () => {
    state.waterLogs = []

    const page = await open()

    expect(page.findAll('[data-testid="history-row"]')).toHaveLength(0)
    expect(page.get('[data-testid="history-empty"]').text()).not.toBe('')
  })
})

describe('記錄水質 — 資料還在路上', () => {
  // Given 資料還在路上（#84 之後是 SPA，首屏沒有伺服器算好的畫面）
  // When 畫面渲染
  // Then 顯示載入樣態，不得先閃一次「還沒有任何記錄」的空狀態
  it('載入中顯示載入樣態，不先閃空狀態', async () => {
    state.hold.get = gate()

    const page = await open()

    expect(page.get('[data-testid="water-log-loading"]').exists()).toBe(true)
    expect(page.find('[data-testid="history-empty"]').exists()).toBe(false)
    expect(page.find('[data-testid="tank-empty"]').exists()).toBe(false)

    state.hold.get.open()
    await settle()

    expect(page.find('[data-testid="water-log-loading"]').exists()).toBe(false)
    expect(historyIds(page)).toEqual(['log-1', 'log-2', 'log-3'])
  })
})

describe('記錄水質 — 儲存失敗', () => {
  // Given 儲存失敗（網路中斷、驗證被 server 拒絕）/ When 我看到錯誤
  // Then 我剛才輸入的值全部還在，可以修正後重送
  it('失敗時輸入值全部保留', async () => {
    state.post.fail = true

    const page = await open()

    await fill(page, { KH: '7.8', CA: '412' })
    await submit(page)

    expect(page.get('[data-testid="water-log-error"]').exists()).toBe(true)
    expect((page.get('input[name="KH"]').element as HTMLInputElement).value).toBe('7.8')
    expect((page.get('input[name="CA"]').element as HTMLInputElement).value).toBe('412')
    expect(historyIds(page)).toEqual(['log-1', 'log-2', 'log-3'])
  })

  // server 把可以直接顯示的中文放在 data.message（statusMessage 過不了 h3 的 ASCII 過濾）
  it('原樣顯示 server 給的訊息', async () => {
    state.post.fail = true
    state.post.failure = {
      statusCode: 400,
      statusMessage: 'Invalid water log input',
      message: '讀值必須是大於或等於零的數字。',
    }

    const page = await open()

    await fill(page, { KH: '7.8' })
    await submit(page)

    expect(page.get('[data-testid="water-log-error"]').text()).toBe('讀值必須是大於或等於零的數字。')
  })

  // 連不上、逾時、500——說不出原因時仍然要有話可說
  it('server 沒有說明原因時退回通用訊息', async () => {
    state.post.fail = true
    state.post.failure = { statusCode: 500, statusMessage: 'Internal Server Error', message: null }

    const page = await open()

    await fill(page, { KH: '7.8' })
    await submit(page)

    expect(page.get('[data-testid="water-log-error"]').text()).toBe('儲存失敗，請稍後再試。')
  })
})

describe('記錄水質 — 尚未建立任何缸', () => {
  // 「<缸名> · <尺寸>」與「這個缸的水質」在沒有缸的時候無從顯示，整頁不能因此壞掉
  it('沒有任何缸時顯示建立缸的入口，不顯示輸入欄', async () => {
    state.tanks = []

    const page = await open()

    expect(page.get('[data-testid="tank-empty"]').exists()).toBe(true)
    expect(page.get('[data-testid="tank-empty-action"]').attributes('href')).toBe('/tanks/new')
    expect(page.findAll('[data-testid="reading-field"]')).toHaveLength(0)
  })
})

// issue #132：請求失敗時 useAsyncData 的 data 是 null，而這一頁只分「載入中」與
// 「載入完」兩態，於是 `v-else-if="!tank"` 一律接住——「拿不到資料」被講成
// 「你沒有資料」。/log 是三頁裡最糟的一條：使用者照著「建立我的第一個缸」按下去，
// 就多了一個他其實不需要的缸。
describe('記錄水質 — 取資料失敗', () => {
  // Given 我有一個缸 / When 我進入 /log 而 API 回 500
  // Then 畫面顯示「載入失敗」與重試的入口，不是空狀態
  it('缸清單回 500 時顯示載入失敗與重試，而不是「還沒有任何缸」', async () => {
    state.fail.tanks = true

    const page = await open()

    expect(page.get('[data-testid="load-error"]').text()).toContain('載入失敗')
    expect(page.get('[data-testid="load-error-retry"]').exists()).toBe(true)
    expect(page.find('[data-testid="tank-empty"]').exists()).toBe(false)
  })

  // And 我不會被引導去建立第二個缸——這一頁的空狀態唯一的出口正是那顆按鈕
  it('載入失敗時沒有任何前往建立缸的入口', async () => {
    state.fail.tanks = true

    const page = await open()

    expect(page.text()).not.toContain('還沒有任何缸')
    expect(page.find('[data-testid="tank-empty-action"]').exists()).toBe(false)
    expect(page.findAll('a').map(link => link.attributes('href'))).not.toContain('/tanks/new')
  })

  // 缸清單成功、水質記錄失敗是同一件事：畫面同樣不能假裝這個缸還沒量過水，
  // 也不能擺出一張存得下去的表單——送出的目的地本來就拿不到
  it('水質記錄回 500 時同樣顯示載入失敗，不顯示「還沒有任何記錄」與輸入欄', async () => {
    state.fail.get = true

    const page = await open()

    expect(page.get('[data-testid="load-error"]').exists()).toBe(true)
    expect(page.find('[data-testid="history-empty"]').exists()).toBe(false)
    expect(page.findAll('[data-testid="reading-field"]')).toHaveLength(0)
  })

  // Given 我真的沒有任何缸 / When 我進入 /log
  // Then 畫面仍然顯示「還沒有任何缸／建立我的第一個缸」
  // （成功但空，與失敗，必須分得出來）
  it('成功但沒有缸時仍是空狀態，不是載入失敗', async () => {
    state.tanks = []

    const page = await open()

    expect(page.find('[data-testid="load-error"]').exists()).toBe(false)
    expect(page.get('[data-testid="tank-empty"]').text()).toContain('還沒有任何缸')
    expect(page.get('[data-testid="tank-empty-action"]').attributes('href')).toBe('/tanks/new')
  })

  // Given 畫面顯示載入失敗 / When 我點「重試」
  // Then 重新發出同一個請求，成功後正常顯示
  it('點「重試」重新發出請求，成功後正常顯示', async () => {
    state.fail.tanks = true

    const page = await open()

    expect(page.get('[data-testid="load-error"]').exists()).toBe(true)

    state.fail.tanks = false

    await page.get('[data-testid="load-error-retry"]').trigger('click')
    await settle()

    // 重試是兩支請求接力（先問有哪些缸，再問那個缸的記錄），資料到齊會晚於
    // 「錯誤區塊消失」——等的是最終樣態
    await vi.waitFor(() => {
      expect(page.find('[data-testid="load-error"]').exists()).toBe(false)
      expect(historyIds(page)).toEqual(['log-1', 'log-2', 'log-3'])
    })

    expect(page.get('[data-testid="water-log-subtitle"]').text()).toBe('主缸 · 4 尺')
    expect(page.findAll('[data-testid="reading-field"]')).toHaveLength(6)
  })

  // 第二支請求失敗時按重試，重打的必須包含它——只重打缸清單的話，
  // 水質記錄那一半會永遠停在失敗狀態，按幾次都一樣
  it('水質記錄失敗時按重試也會重新取回水質記錄', async () => {
    state.fail.get = true

    const page = await open()

    expect(page.get('[data-testid="load-error"]').exists()).toBe(true)

    state.fail.get = false

    await page.get('[data-testid="load-error-retry"]').trigger('click')
    await settle()

    await vi.waitFor(() => {
      expect(page.find('[data-testid="load-error"]').exists()).toBe(false)
      expect(historyIds(page)).toEqual(['log-1', 'log-2', 'log-3'])
    })
  })

  // 重試期間 status 會從 'error' 翻成 'pending'，「只看 error」的寫法會在那一段
  // 把錯誤區塊拆掉。這一頁還多一層：pending 會落到骨架，而骨架之後若請求再次失敗，
  // 中間那一拍就成了「什麼都沒說」。要嘛換成資料，要嘛留在錯誤畫面上。
  it('重試進行中畫面停在載入失敗，不閃過空狀態或骨架', async () => {
    state.fail.tanks = true

    const page = await open()

    state.fail.tanks = false
    // 把重試那一輪的第二支請求停在半路，才看得到「請求還在路上」的那一段
    state.hold.get = gate()

    // 刻意不 await：要看的正是中間那一拍
    void page.get('[data-testid="load-error-retry"]').trigger('click')
    await flushPromises()

    expect(page.get('[data-testid="load-error"]').exists()).toBe(true)
    expect(page.find('[data-testid="tank-empty"]').exists()).toBe(false)
    expect(page.find('[data-testid="water-log-loading"]').exists()).toBe(false)
    expect(page.get('[data-testid="load-error-retry"]').attributes('disabled')).toBeDefined()

    // 收尾：這一輪本來就會成功，等它落地免得殘留到下一題
    state.hold.get.open()

    await vi.waitFor(() => {
      expect(page.find('[data-testid="load-error"]').exists()).toBe(false)
    })
  })
})
