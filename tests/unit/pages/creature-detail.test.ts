import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import CreatureDetailPage from '../../../app/pages/creatures/[id].vue'
import { signedInUserSession } from '../support/session'
import type { CreatureDetailDto } from '#shared/types/creature'

// 生物詳情 · 死亡記錄（Epic #1 screen-6，issue #14）。

// 這一頁要登入才進得去（#67 的全域路由保護）。少了這張 session，mountSuspended
// 的導覽會先被導去 /login，頁面就拿不到網址上的 :id。
mockNuxtImport('useUserSession', () => () => signedInUserSession())

function creature(overrides: Partial<CreatureDetailDto> = {}): CreatureDetailDto {
  return {
    id: 'f5',
    name: '火焰仙',
    scientificName: 'Centropyge loriculus',
    category: 'FISH',
    subCategory: '神仙',
    status: 'ALIVE',
    photoUrl: null,
    addedOn: '2025-11-12',
    ailment: null,
    observedSickOn: null,
    diedOn: null,
    causeOfDeath: null,
    deathNote: null,
    ...overrides,
  }
}

/** 「在缸天數」是相對今天的推算值，固定日期 + 真實時鐘會隨日期漂移 */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

const state = {
  creature: creature() as CreatureDetailDto | null,
  /**
   * GET 這一支要以哪個狀態碼失敗（issue #132）。
   * null 代表照常回應——「這一隻不存在」仍然是把 state.creature 設成 null。
   */
  getFailure: null as number | null,
  /** 這一輪 PATCH 收到的 body */
  body: null as Record<string, unknown> | null,
  patchCalls: 0,
  fail: false,
}

/**
 * registerEndpoint 底下跑的是 h3 的 node listener，$fetch 送出的 body
 * 原樣掛在 node 請求物件上（node-mock-http 的行為）。
 */
interface MockNodeEvent {
  node: { req: { body?: string } }
}

registerEndpoint('/api/creatures/f5', {
  method: 'GET',
  handler: () => {
    if (state.getFailure !== null) {
      throw createError({ statusCode: state.getFailure, statusMessage: 'Internal Server Error' })
    }

    if (!state.creature) {
      throw createError({ statusCode: 404, statusMessage: 'Creature not found' })
    }

    return { creature: state.creature }
  },
})

registerEndpoint('/api/creatures/f5', {
  method: 'PATCH',
  handler: (event) => {
    state.patchCalls += 1
    state.body = JSON.parse((event as unknown as MockNodeEvent).node.req.body ?? 'null')

    if (state.fail) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid creature status input',
        data: { message: '儲存失敗的原因' },
      })
    }

    state.creature = { ...state.creature!, ...state.body } as CreatureDetailDto

    return { creature: state.creature }
  },
})

enableAutoUnmount(afterEach)

beforeEach(() => {
  // useAsyncData 的結果會留在 payload 上，測試之間必須清掉才不會拿到上一題的資料
  clearNuxtData()

  state.creature = creature()
  state.getFailure = null
  state.body = null
  state.patchCalls = 0
  state.fail = false
})

type Page = Awaited<ReturnType<typeof mountSuspended>>

function open() {
  return mountSuspended(CreatureDetailPage, { route: '/creatures/f5' })
}

function statusOption(page: Page, status: string) {
  return page.get(`[data-testid="status-option"][data-status="${status}"]`)
}

function causeOption(page: Page, cause: string) {
  return page.get(`[data-testid="death-cause-option"][data-cause="${cause}"]`)
}

async function save(page: Page) {
  await page.get('[data-testid="creature-save"]').trigger('click')
  await flushPromises()
}

describe('生物詳情 — 頁首與基本資料', () => {
  // Given 我從首頁或生物庫存點進某隻生物 / When 詳情頁載入
  // And 頁首左側有 ← 返回、右側有「編輯」
  it('頁首左側是返回生物列表，右側是「編輯」', async () => {
    const page = await open()

    expect(page.get('[data-testid="creature-back"]').attributes('href')).toBe('/creatures')
    expect(page.get('[data-testid="creature-back"]').attributes('aria-label')).toBe('返回生物列表')

    const edit = page.get('[data-testid="creature-edit"]')
    expect(edit.text()).toContain('編輯')
    expect(edit.attributes('href')).toBe('/creatures/f5/edit')
  })

  // Then 顯示照片、俗名、學名，以及「<分類> · <細分類>」標籤（如「魚 · 神仙」）
  it('顯示照片、俗名、學名與「魚 · 神仙」標籤', async () => {
    state.creature = creature({ photoUrl: 'https://example.test/flame.jpg' })

    const page = await open()

    expect(page.get('[data-testid="creature-name"]').text()).toBe('火焰仙')
    expect(page.get('[data-testid="creature-scientific-name"]').text()).toBe('Centropyge loriculus')
    expect(page.get('[data-testid="creature-taxonomy"]').text()).toBe('魚 · 神仙')
    expect(page.get('[data-testid="creature-photo"] img').attributes('src'))
      .toBe('https://example.test/flame.jpg')
  })

  // Given 該生物沒有照片或沒有細分類 / When 詳情頁載入
  // Then 照片區顯示預設圖示，標籤只顯示分類本身（如「魚」），不出現多餘的分隔點
  it('沒有照片時顯示預設圖示，沒有細分類時標籤只有「魚」', async () => {
    state.creature = creature({ photoUrl: null, subCategory: null })

    const page = await open()

    expect(page.find('[data-testid="creature-photo"] img').exists()).toBe(false)
    expect(page.get('[data-testid="creature-photo-placeholder"]').exists()).toBe(true)

    const taxonomy = page.get('[data-testid="creature-taxonomy"]')
    expect(taxonomy.text()).toBe('魚')
    expect(taxonomy.text()).not.toContain('·')
  })

  // 沒有學名時不留下空白的一行
  it('沒有學名時不渲染學名那一行', async () => {
    state.creature = creature({ scientificName: null })

    const page = await open()

    expect(page.find('[data-testid="creature-scientific-name"]').exists()).toBe(false)
  })
})

describe('生物詳情 — 狀態切換', () => {
  // Given 我在詳情頁 / When 畫面載入
  // Then 「狀態」區顯示三個互斥選項：存活 / 生病 / 死亡，且目前狀態呈選中態
  it('三個互斥選項，目前狀態呈選中態', async () => {
    state.creature = creature({ status: 'SICK', ailment: '白點', observedSickOn: daysAgo(3) })

    const page = await open()
    const options = page.findAll('[data-testid="status-option"]')

    expect(options.map(option => option.text())).toEqual(['存活', '生病', '死亡'])
    expect(options.map(option => option.attributes('aria-pressed'))).toEqual(['false', 'true', 'false'])
  })

  it('點另一個狀態後，只有那一個是選中的', async () => {
    const page = await open()

    await statusOption(page, 'DEAD').trigger('click')

    const pressed = page
      .findAll('[data-testid="status-option"]')
      .filter(option => option.attributes('aria-pressed') === 'true')

    expect(pressed).toHaveLength(1)
    expect(pressed[0]!.attributes('data-status')).toBe('DEAD')
  })

  // 沒有改動時沒有東西可存，儲存按鈕整顆不出現（PR #58 review）
  it('什麼都沒改時不渲染儲存按鈕', async () => {
    const page = await open()

    expect(page.find('[data-testid="creature-save"]').exists()).toBe(false)
  })

  it('改了狀態之後儲存按鈕才出現，且可以按', async () => {
    const page = await open()

    await statusOption(page, 'DEAD').trigger('click')

    const button = page.get('[data-testid="creature-save"]')
    expect(button.text()).toContain('儲存')
    expect(button.attributes('disabled')).toBeUndefined()
  })

  // 只改記錄區塊裡的欄位（狀態按鈕沒動）同樣算「狀態欄位中有值變更」
  it('只改死亡記錄裡的備註，儲存按鈕也會出現', async () => {
    state.creature = creature({ status: 'DEAD', diedOn: '2026-05-20', causeOfDeath: 'JUMPED' })

    const page = await open()

    expect(page.find('[data-testid="creature-save"]').exists()).toBe(false)

    await page.get('textarea[name="deathNote"]').setValue('半夜跳出主缸')

    expect(page.find('[data-testid="creature-save"]').exists()).toBe(true)
  })

  it('改完又改回原本的狀態，儲存按鈕再次收起來', async () => {
    const page = await open()

    await statusOption(page, 'DEAD').trigger('click')
    await statusOption(page, 'ALIVE').trigger('click')

    expect(page.find('[data-testid="creature-save"]').exists()).toBe(false)
  })

  it('儲存成功後儲存按鈕收起來', async () => {
    const page = await open()

    await statusOption(page, 'DEAD').trigger('click')
    await page.get('input[name="diedOn"]').setValue('2026-05-20')
    await save(page)

    expect(state.patchCalls).toBe(1)
    expect(page.find('[data-testid="creature-save"]').exists()).toBe(false)
  })

  // 儲存失敗時改動還在，按鈕與錯誤訊息都要留著讓人再按一次
  it('儲存失敗時按鈕留在畫面上', async () => {
    state.fail = true

    const page = await open()

    await statusOption(page, 'DEAD').trigger('click')
    await page.get('input[name="diedOn"]').setValue('2026-05-20')
    await save(page)

    expect(page.find('[data-testid="creature-save"]').exists()).toBe(true)
    expect(page.get('[data-testid="creature-error"]').text()).toBe('儲存失敗的原因')
  })
})

describe('生物詳情 — 死亡記錄', () => {
  // Given 某生物目前狀態為存活 / When 我點選「死亡」
  // Then 展開「死亡記錄」區塊，包含發病日、死亡日、死因六選一與備註欄
  it('點「死亡」後展開死亡記錄：發病日、死亡日、死因六選一與備註', async () => {
    const page = await open()

    expect(page.find('[data-testid="death-record"]').exists()).toBe(false)

    await statusOption(page, 'DEAD').trigger('click')

    const record = page.get('[data-testid="death-record"]')
    expect(record.text()).toContain('死亡記錄')
    expect(record.get('input[name="observedSickOn"]').attributes('type')).toBe('date')
    expect(record.get('input[name="diedOn"]').attributes('type')).toBe('date')
    expect(record.get('textarea[name="deathNote"]').exists()).toBe(true)

    expect(record.findAll('[data-testid="death-cause-option"]').map(option => option.text())).toEqual([
      '生病',
      '水質變化',
      '被獵食 / 打架',
      '跳缸',
      '餓死（不開口）',
      '原因不明',
    ])
  })

  // When 我選擇死因「跳缸」、填入死亡日並儲存
  // Then 該生物狀態變為死亡，死因與死亡日被保存
  it('選死因「跳缸」、填死亡日並儲存，送出狀態、死因與死亡日', async () => {
    const page = await open()

    await statusOption(page, 'DEAD').trigger('click')
    await page.get('input[name="diedOn"]').setValue('2026-05-20')
    await causeOption(page, 'JUMPED').trigger('click')
    await page.get('textarea[name="deathNote"]').setValue('半夜跳出主缸')
    await save(page)

    expect(state.patchCalls).toBe(1)
    expect(state.body).toEqual({
      status: 'DEAD',
      observedSickOn: null,
      ailment: null,
      diedOn: '2026-05-20',
      causeOfDeath: 'JUMPED',
      deathNote: '半夜跳出主缸',
    })

    // 儲存後畫面顯示的就是存下去的狀態
    expect(statusOption(page, 'DEAD').attributes('aria-pressed')).toBe('true')
    expect(causeOption(page, 'JUMPED').attributes('aria-pressed')).toBe('true')
    expect(page.find('[data-testid="creature-error"]').exists()).toBe(false)
  })

  it('同一時間只有一個死因被選中', async () => {
    const page = await open()

    await statusOption(page, 'DEAD').trigger('click')
    await causeOption(page, 'DISEASE').trigger('click')
    await causeOption(page, 'JUMPED').trigger('click')

    const pressed = page
      .findAll('[data-testid="death-cause-option"]')
      .filter(option => option.attributes('aria-pressed') === 'true')

    expect(pressed).toHaveLength(1)
    expect(pressed[0]!.attributes('data-cause')).toBe('JUMPED')
  })

  // Given 我選擇狀態為「死亡」但未填死亡日 / When 我嘗試儲存
  // Then 顯示驗證錯誤，儲存被阻擋
  it('沒填死亡日就儲存：顯示驗證錯誤且不送出', async () => {
    const page = await open()

    await statusOption(page, 'DEAD').trigger('click')
    await save(page)

    expect(state.patchCalls).toBe(0)
    expect(page.get('[data-testid="creature-error"]').text()).toContain('死亡日')
  })

  // Given 我填入的死亡日早於入缸日 / When 我嘗試儲存 / Then 顯示日期先後順序的驗證錯誤
  it('死亡日早於入缸日：顯示驗證錯誤且不送出', async () => {
    const page = await open()

    await statusOption(page, 'DEAD').trigger('click')
    await page.get('input[name="diedOn"]').setValue('2025-11-11')
    await save(page)

    expect(state.patchCalls).toBe(0)
    expect(page.get('[data-testid="creature-error"]').text()).toContain('死亡日不能早於入缸日')
  })

  // Given 發病日晚於死亡日 / When 我嘗試儲存 / Then 顯示日期先後順序的驗證錯誤
  it('發病日晚於死亡日：顯示驗證錯誤且不送出', async () => {
    const page = await open()

    await statusOption(page, 'DEAD').trigger('click')
    await page.get('input[name="diedOn"]').setValue('2026-05-20')
    await page.get('input[name="observedSickOn"]').setValue('2026-05-21')
    await save(page)

    expect(state.patchCalls).toBe(0)
    expect(page.get('[data-testid="creature-error"]').text()).toContain('發病日不能晚於死亡日')
  })

  it('API 說明了失敗原因時，原樣顯示那則訊息', async () => {
    state.fail = true

    const page = await open()

    await statusOption(page, 'DEAD').trigger('click')
    await page.get('input[name="diedOn"]').setValue('2026-05-20')
    await save(page)

    expect(state.patchCalls).toBe(1)
    expect(page.get('[data-testid="creature-error"]').text()).toBe('儲存失敗的原因')
  })
})

describe('生物詳情 — 生病記錄', () => {
  // Given 我把狀態切為「生病」/ When 區塊渲染
  // Then 顯示發病日與症狀欄位（不要求死亡日與死因）
  it('切到「生病」後只有發病日與症狀，沒有死亡日與死因', async () => {
    const page = await open()

    await statusOption(page, 'SICK').trigger('click')

    const record = page.get('[data-testid="sick-record"]')
    expect(record.get('input[name="observedSickOn"]').attributes('type')).toBe('date')
    expect(record.get('input[name="ailment"]').exists()).toBe(true)

    expect(page.find('input[name="diedOn"]').exists()).toBe(false)
    expect(page.findAll('[data-testid="death-cause-option"]')).toHaveLength(0)
  })

  // When 我填入發病日與症狀並儲存
  // Then 該生物在首頁卡片顯示「⚠ 觀察中」與「生病 · <症狀>」，
  //      在庫存列表顯示「<症狀> · 觀察第 N 天」
  //      （兩張畫面的字串由 shared/utils 產生，見 tests/unit/shared/creature-detail.test.ts）
  it('填發病日與症狀後儲存，送出生病狀態與那兩個欄位', async () => {
    const page = await open()

    await statusOption(page, 'SICK').trigger('click')
    await page.get('input[name="observedSickOn"]').setValue('2026-07-26')
    await page.get('input[name="ailment"]').setValue('白點')
    await save(page)

    expect(state.patchCalls).toBe(1)
    expect(state.body).toEqual({
      status: 'SICK',
      observedSickOn: '2026-07-26',
      ailment: '白點',
      diedOn: null,
      causeOfDeath: null,
      deathNote: null,
    })
  })
})

describe('生物詳情 — 改回存活', () => {
  // Given 我把一隻已標記死亡的生物改回「存活」/ When 我儲存
  // Then 死亡相關資料（死亡日 / 死因 / 死亡備註）被清除，狀態回到存活
  it('改回存活並儲存後，死亡日 / 死因 / 死亡備註都被清除', async () => {
    state.creature = creature({
      status: 'DEAD',
      observedSickOn: '2026-05-16',
      ailment: '白點',
      diedOn: '2026-05-20',
      causeOfDeath: 'JUMPED',
      deathNote: '半夜跳出主缸',
    })

    const page = await open()

    await statusOption(page, 'ALIVE').trigger('click')
    await save(page)

    expect(state.body).toMatchObject({
      status: 'ALIVE',
      diedOn: null,
      causeOfDeath: null,
      deathNote: null,
    })

    expect(state.creature).toMatchObject({
      status: 'ALIVE',
      diedOn: null,
      causeOfDeath: null,
      deathNote: null,
    })

    // 死亡記錄區塊跟著收起來
    expect(page.find('[data-testid="death-record"]').exists()).toBe(false)
    expect(statusOption(page, 'ALIVE').attributes('aria-pressed')).toBe('true')
  })
})

describe('生物詳情 — 入缸日與在缸天數', () => {
  // Given 某生物於 2025/11/12 入缸、於 05/20 死亡 / When 詳情頁載入
  // Then 底部顯示「入缸日 2025 / 11 / 12」與「在缸天數 189 天」，天數由入缸日算到死亡日
  it('已死亡：入缸日照原樣顯示，天數算到死亡日', async () => {
    state.creature = creature({
      status: 'DEAD',
      addedOn: '2025-11-12',
      diedOn: '2026-05-20',
      causeOfDeath: 'JUMPED',
    })

    const page = await open()

    expect(page.get('[data-testid="creature-added-on"]').text()).toBe('2025 / 11 / 12')
    expect(page.get('[data-testid="creature-days-in-tank"]').text()).toBe('189 天')
  })

  // Given 某生物仍存活 / When 詳情頁載入
  // Then 「在缸天數」由入缸日算到今天，且每天自動增加（不是儲存下來的固定值）
  it('仍存活：天數由入缸日算到今天', async () => {
    state.creature = creature({ addedOn: daysAgo(42) })

    const page = await open()

    expect(page.get('[data-testid="creature-days-in-tank"]').text()).toBe('42 天')
  })

  // 「在缸天數」是推算值：把同一隻標成死亡並存下去，天數立刻改用死亡日重算
  it('存成死亡之後，天數改用死亡日重算', async () => {
    state.creature = creature({ addedOn: '2025-11-12' })

    const page = await open()

    await statusOption(page, 'DEAD').trigger('click')
    await page.get('input[name="diedOn"]').setValue('2026-05-20')
    await save(page)

    expect(page.get('[data-testid="creature-days-in-tank"]').text()).toBe('189 天')
  })
})

describe('生物詳情 — 找不到這隻生物', () => {
  // 網址被改成不存在（或不屬於自己）的 id 時，整頁不能因此壞掉
  it('API 回 404 時顯示找不到的說明與返回列表的入口', async () => {
    state.creature = null

    const page = await open()

    expect(page.get('[data-testid="creature-missing"]').text()).not.toBe('')
    expect(page.get('[data-testid="creature-back"]').attributes('href')).toBe('/creatures')
    expect(page.findAll('[data-testid="status-option"]')).toHaveLength(0)
  })
})

// issue #132：這一頁原本把所有失敗都吞成 null，於是 500 也被講成「找不到這隻生物」。
// 「這一隻不存在」與「拿不到資料」是兩件事，畫面必須分得出來。
describe('生物詳情 — 取資料失敗', () => {
  // Given 這隻生物存在 / When 我進入詳情頁而 API 回 500
  // Then 畫面顯示「載入失敗」與重試的入口，不是「找不到這隻生物」
  it('回 500 時顯示載入失敗與重試，而不是「找不到這隻生物」', async () => {
    state.getFailure = 500

    const page = await open()

    expect(page.get('[data-testid="load-error"]').text()).toContain('載入失敗')
    expect(page.get('[data-testid="load-error-retry"]').exists()).toBe(true)
    expect(page.find('[data-testid="creature-missing"]').exists()).toBe(false)
  })

  // 404 是「真的沒有這一隻」，那一句話仍然要說得出口
  it('回 404 時仍然顯示「找不到這隻生物」，不是載入失敗', async () => {
    state.creature = null

    const page = await open()

    expect(page.find('[data-testid="load-error"]').exists()).toBe(false)
    expect(page.get('[data-testid="creature-missing"]').text()).toContain('找不到這隻生物')
  })

  // Given 畫面顯示載入失敗 / When 我點「重試」/ Then 重新發出同一個請求，成功後正常顯示
  it('點「重試」重新發出請求，成功後正常顯示', async () => {
    state.getFailure = 500

    const page = await open()

    expect(page.get('[data-testid="load-error"]').exists()).toBe(true)

    state.getFailure = null

    await page.get('[data-testid="load-error-retry"]').trigger('click')
    await flushPromises()

    expect(page.find('[data-testid="load-error"]').exists()).toBe(false)
    expect(page.get('[data-testid="creature-name"]').text()).toBe('火焰仙')
  })

  // 重試期間 status 會從 'error' 翻成 'pending'，「只看 error」的寫法會在那一段
  // 把錯誤區塊拆掉——畫面於是閃過一次「找不到這隻生物」
  it('重試進行中畫面停在載入失敗，不閃過「找不到這隻生物」', async () => {
    state.getFailure = 500

    const page = await open()

    state.getFailure = null

    // 刻意不 await：要看的正是「請求還在路上」的那一段
    void page.get('[data-testid="load-error-retry"]').trigger('click')
    await nextTick()

    expect(page.get('[data-testid="load-error"]').exists()).toBe(true)
    expect(page.find('[data-testid="creature-missing"]').exists()).toBe(false)

    await vi.waitFor(() => {
      expect(page.find('[data-testid="load-error"]').exists()).toBe(false)
    })
  })

  // 失敗的是「這一頁的資料」，不是整個 App——底部返回的入口要留著，人才走得回去
  it('載入失敗時頁首的返回入口仍在', async () => {
    state.getFailure = 500

    const page = await open()

    expect(page.get('[data-testid="creature-back"]').attributes('href')).toBe('/creatures')
  })
})
