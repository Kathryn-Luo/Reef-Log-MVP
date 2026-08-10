import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import CreatureDetailPage from '../../../app/pages/creatures/[id].vue'
import { signedInUserSession } from '../support/session'
import type { CreatureDetailDto } from '#shared/types/creature'
import type { TankOption } from '#shared/types/home'

// 生物詳情 · 死亡記錄（Epic #1 screen-6，issue #14）。

// 這一頁要登入才進得去（#67 的全域路由保護）。少了這張 session，mountSuspended
// 的導覽會先被導去 /login，頁面就拿不到網址上的 :id。
mockNuxtImport('useUserSession', () => () => signedInUserSession())

function creature(overrides: Partial<CreatureDetailDto> = {}): CreatureDetailDto {
  return {
    id: 'f5',
    tankId: 'tank-1',
    tankName: '主缸',
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

/** 缸切換選單與「移動到其他缸」共用的形狀（GET /api/tanks 回的就是它） */
function tank(id: string, name: string, sizeSpec: string, volumeLiters: number): TankOption {
  return { id, name, sizeSpec, volumeLiters, setupType: null, colorHex: '#2dd4bf' }
}

/** 送出中那一段要停得住：move 停在這個閘門上，由測試自己放行（issue #120） */
function gate() {
  let release = () => {}
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })

  return { promise, release }
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
  /** 目前使用者名下未封存的缸（issue #120 的目標缸清單來源） */
  tanks: [] as TankOption[],
  /** 這一輪 PATCH /move 收到的 body 與呼叫次數 */
  moveBody: null as Record<string, unknown> | null,
  moveCalls: 0,
  /** move 要以哪個狀態碼失敗，null 代表成功 */
  moveFailure: null as number | null,
  /** 有值時 move 會停在這裡，直到測試放行 */
  moveGate: null as ReturnType<typeof gate> | null,
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

registerEndpoint('/api/tanks', {
  method: 'GET',
  handler: () => ({ tanks: state.tanks }),
})

registerEndpoint('/api/creatures/f5/move', {
  method: 'PATCH',
  handler: (event) => {
    state.moveCalls += 1
    state.moveBody = JSON.parse((event as unknown as MockNodeEvent).node.req.body ?? 'null')

    function respond() {
      if (state.moveFailure !== null) {
        throw createError({ statusCode: state.moveFailure, statusMessage: 'Move failed' })
      }

      const target = state.tanks.find(candidate => candidate.id === state.moveBody?.tankId)

      if (!target) {
        throw createError({ statusCode: 404, statusMessage: 'Tank not found' })
      }

      // 換缸只改歸屬，其餘欄位原樣留著——重新取回的詳情因此只有「所在缸」不同
      state.creature = { ...state.creature!, tankId: target.id, tankName: target.name }

      return { creatureId: 'f5', tankId: target.id }
    }

    // 沒有閘門時同步回答：多一層 await 會讓「成功後重新取回詳情」多欠一個 tick，
    // 測試就得多 flush 一次才看得到結果。要停在「送出中」的那一條才走非同步。
    return state.moveGate ? state.moveGate.promise.then(respond) : respond()
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
  state.tanks = [
    tank('tank-1', '主缸', '4 尺', 420),
    tank('tank-2', '珊瑚缸', '3 尺', 240),
    tank('tank-3', '檢疫缸', '2 尺', 90),
  ]
  state.moveBody = null
  state.moveCalls = 0
  state.moveFailure = null
  state.moveGate = null
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

async function openMoveSheet(page: Page) {
  await page.get('[data-testid="creature-move-open"]').trigger('click')
  await flushPromises()
}

function moveOption(page: Page, tankId: string) {
  return page.get(`[data-testid="creature-move-option"][data-tank-id="${tankId}"]`)
}

/** 目前列在 sheet 上的目標缸 id，順序即畫面順序 */
function moveOptionIds(page: Page): (string | undefined)[] {
  return page.findAll('[data-testid="creature-move-option"]').map(option => option.attributes('data-tank-id'))
}

async function selectTank(page: Page, tankId: string) {
  await moveOption(page, tankId).trigger('click')
}

async function confirmMove(page: Page) {
  await page.get('[data-testid="creature-move-confirm"]').trigger('click')

  // 兩次：送出換缸是第一趟，成功後重新取回詳情（畫面不做樂觀更新）是第二趟
  await flushPromises()
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

// ── 移動到其他缸（issue #120）─────────────────────────────────────
//
// 這一組驗的是「畫得出來 / 整塊不存在」與「請求送了幾次」，不是「按下去有沒有改旗標」
// ——旗標綠而功能壞是本專案踩過的坑（PR #145，見 CLAUDE.md）。

describe('生物詳情 — 所在缸與移動入口', () => {
  // Given 名下有另一個未封存的缸 / When 我查看該頁
  // Then 我看得到這隻生物目前所在的缸 / And 我看得到「移動到其他缸」的入口
  it('看得到所在缸（缸名 · 尺寸 · 水量）與「移動到其他缸」的入口', async () => {
    const page = await open()

    const current = page.get('[data-testid="creature-current-tank"]')
    expect(current.text()).toContain('主缸')
    expect(current.text()).toContain('4 尺')
    expect(current.text()).toContain('420 L')

    expect(page.get('[data-testid="creature-move-open"]').text()).toContain('移動到其他缸')
  })

  // Given 我名下沒有其他可移動的未封存缸 / When 我查看該生物詳情
  // Then 「所在缸」的欄位與資訊，以及「移動到其他缸」的入口，都不出現
  it('名下沒有其他缸時，整塊不存在——不是變成 disabled', async () => {
    state.tanks = [tank('tank-1', '主缸', '4 尺', 420)]

    const page = await open()

    expect(page.find('[data-testid="creature-tank-section"]').exists()).toBe(false)
    expect(page.find('[data-testid="creature-current-tank"]').exists()).toBe(false)
    expect(page.find('[data-testid="creature-move-open"]').exists()).toBe(false)
    expect(page.text()).not.toContain('移動到其他缸')
  })

  // 這一頁其餘的內容不受影響：沒有別的缸只代表「移不了」，不是「這一頁壞了」
  it('名下沒有其他缸時，入缸日與狀態三選一照常顯示', async () => {
    state.tanks = [tank('tank-1', '主缸', '4 尺', 420)]

    const page = await open()

    expect(page.findAll('[data-testid="status-option"]')).toHaveLength(3)
    expect(page.get('[data-testid="creature-added-on"]').text()).toBe('2025 / 11 / 12')
  })
})

describe('生物詳情 — 選擇目標缸的 sheet', () => {
  // Given 名下有另一個未封存的缸 / When 我啟動「移動到其他缸」
  // Then 底部升起可選目標缸的 sheet
  it('啟動入口後 sheet 升起，標題與副標說明現在在哪一缸', async () => {
    const page = await open()

    expect(page.find('[data-testid="creature-move-sheet"]').exists()).toBe(false)

    await openMoveSheet(page)

    const sheet = page.get('[data-testid="creature-move-sheet"]')
    expect(sheet.attributes('role')).toBe('dialog')
    expect(page.get('[data-testid="creature-move-title"]').text()).toBe('移動到其他缸')

    const subtitle = page.get('[data-testid="creature-move-subtitle"]')
    expect(subtitle.text()).toContain('火焰仙')
    expect(subtitle.text()).toContain('目前在')
    expect(subtitle.text()).toContain('主缸')
  })

  // And 清單列出我名下其他未封存的缸，不包含牠目前所在的那一個
  it('清單只有其他缸，目前所在的那一個不列進去', async () => {
    const page = await open()

    await openMoveSheet(page)

    expect(moveOptionIds(page)).toEqual(['tank-2', 'tank-3'])

    const list = page.get('[data-testid="creature-move-list"]')
    expect(list.text()).toContain('珊瑚缸')
    expect(list.text()).toContain('3 尺')
    expect(list.text()).toContain('240 L')
    expect(list.text()).not.toContain('主缸')
  })

  // And 我能選擇其中一個缸，再以第二步確認送出
  it('選了缸之後才出現確認鈕，文案帶著目的地', async () => {
    const page = await open()

    await openMoveSheet(page)

    expect(page.find('[data-testid="creature-move-confirm"]').exists()).toBe(false)

    await selectTank(page, 'tank-2')

    expect(moveOption(page, 'tank-2').attributes('aria-pressed')).toBe('true')
    expect(moveOption(page, 'tank-3').attributes('aria-pressed')).toBe('false')
    expect(page.get('[data-testid="creature-move-confirm"]').text()).toContain('移動到珊瑚缸')
  })

  // Given sheet 已展開 / When 我還沒有選擇任何目標缸 / Then 不會送出任何請求
  it('還沒選任何目標缸時沒有東西可以送出，也沒有請求送出去', async () => {
    const page = await open()

    await openMoveSheet(page)
    await flushPromises()

    expect(page.find('[data-testid="creature-move-confirm"]').exists()).toBe(false)
    expect(state.moveCalls).toBe(0)
  })

  // 選了但還沒確認——第二步才是送出，選取本身不送
  it('只選不確認時不送出請求', async () => {
    const page = await open()

    await openMoveSheet(page)
    await selectTank(page, 'tank-2')
    await flushPromises()

    expect(state.moveCalls).toBe(0)
  })

  it('「取消」把 sheet 收起來，而且不送出請求', async () => {
    const page = await open()

    await openMoveSheet(page)
    await selectTank(page, 'tank-2')
    await page.get('[data-testid="creature-move-cancel"]').trigger('click')

    expect(page.find('[data-testid="creature-move-sheet"]').exists()).toBe(false)
    expect(state.moveCalls).toBe(0)
  })
})

describe('生物詳情 — 確認移動', () => {
  // Given 我已選擇自己名下另一個未封存的缸 / When 我確認移動 / Then UI 呼叫既有換缸 API
  it('確認後呼叫 PATCH /api/creatures/:id/move，body 是選中的那一缸', async () => {
    const page = await open()

    await openMoveSheet(page)
    await selectTank(page, 'tank-2')
    await confirmMove(page)

    expect(state.moveCalls).toBe(1)
    expect(state.moveBody).toEqual({ tankId: 'tank-2' })
  })

  // And 成功後畫面更新為一致狀態，「所在缸」顯示為新的缸，不會繼續把生物顯示在原本的缸
  it('成功後「所在缸」換成新的缸，sheet 收起來', async () => {
    const page = await open()

    await openMoveSheet(page)
    await selectTank(page, 'tank-2')
    await confirmMove(page)

    const current = page.get('[data-testid="creature-current-tank"]')
    expect(current.text()).toContain('珊瑚缸')
    expect(current.text()).not.toContain('主缸')
    expect(page.find('[data-testid="creature-move-sheet"]').exists()).toBe(false)
  })

  // 移動之後「其他缸」換人：原本的主缸變成可選的目標，珊瑚缸不再列出
  it('再次開啟 sheet 時，清單改成排除新的所在缸', async () => {
    const page = await open()

    await openMoveSheet(page)
    await selectTank(page, 'tank-2')
    await confirmMove(page)
    await openMoveSheet(page)

    expect(moveOptionIds(page)).toEqual(['tank-1', 'tank-3'])
  })
})

describe('生物詳情 — 送出中', () => {
  // Given 請求正在處理 / When 我再次嘗試確認移動
  // Then 不會送出重複請求 / And 確認鈕顯示處理中且按不下去，缸清單也一併鎖住
  it('送出期間確認鈕鎖住、清單鎖住，再按一次不會送出第二個請求', async () => {
    const moveGate = gate()
    state.moveGate = moveGate

    const page = await open()

    await openMoveSheet(page)
    await selectTank(page, 'tank-2')

    // 刻意不 await：要看的正是「請求還在路上」的那一段
    void page.get('[data-testid="creature-move-confirm"]').trigger('click')
    await flushPromises()

    const confirm = page.get('[data-testid="creature-move-confirm"]')
    expect(confirm.text()).toContain('移動中')
    expect(confirm.attributes('disabled')).toBeDefined()
    expect(moveOption(page, 'tank-2').attributes('disabled')).toBeDefined()
    expect(moveOption(page, 'tank-3').attributes('disabled')).toBeDefined()

    // 處理中不提供取消
    expect(page.get('[data-testid="creature-move-cancel"]').text()).toContain('請稍候')
    expect(page.get('[data-testid="creature-move-cancel"]').attributes('disabled')).toBeDefined()

    await confirmMove(page)
    expect(state.moveCalls).toBe(1)

    // 放行之後那一趟才走完，畫面跟著對齊到伺服器的答案
    moveGate.release()

    await vi.waitFor(() => {
      expect(page.get('[data-testid="creature-current-tank"]').text()).toContain('珊瑚缸')
    })

    expect(state.moveCalls).toBe(1)
  })
})

describe('生物詳情 — 移動失敗', () => {
  // Given API 回傳 400 或 404 / When 畫面收到錯誤
  // Then sheet 上出現錯誤卡片，說明原因並指名該目標缸
  // And 訊息明說後果：生物仍在原本的缸，沒有被移動
  it.each([[404], [400]])('回 %s 時出現錯誤卡片，指名目標缸並說明生物沒有被移動', async (status) => {
    state.moveFailure = status

    const page = await open()

    await openMoveSheet(page)
    await selectTank(page, 'tank-2')
    await confirmMove(page)

    const card = page.get('[data-testid="creature-move-error"]')
    expect(card.text()).toContain('移動失敗')
    expect(card.text()).toContain('珊瑚缸')
    expect(card.text()).toContain('火焰仙')
    expect(card.text()).toContain('主缸')
    expect(card.text()).toContain('未被移動')
  })

  // And 不把 UI 樂觀更新成已移動（詳情頁的「所在缸」仍是原本的缸）
  it.each([[404], [400]])('回 %s 時「所在缸」仍是原本的缸，副標改成「仍在」', async (status) => {
    state.moveFailure = status

    const page = await open()

    await openMoveSheet(page)
    await selectTank(page, 'tank-2')
    await confirmMove(page)

    expect(page.get('[data-testid="creature-move-subtitle"]').text()).toContain('仍在')
    expect(page.get('[data-testid="creature-move-subtitle"]').text()).toContain('主缸')
    expect(page.get('[data-testid="creature-current-tank"]').text()).toContain('主缸')
    expect(page.get('[data-testid="creature-current-tank"]').text()).not.toContain('珊瑚缸')
  })

  // And 主要動作是「選其他缸」，畫面上不出現「重試」
  it.each([[404], [400]])('回 %s 時主要動作是「選其他缸」，畫面上沒有「重試」', async (status) => {
    state.moveFailure = status

    const page = await open()

    await openMoveSheet(page)
    await selectTank(page, 'tank-2')
    await confirmMove(page)

    expect(page.get('[data-testid="creature-move-confirm"]').text()).toContain('選其他缸')
    expect(page.get('[data-testid="creature-move-sheet"]').text()).not.toContain('重試')
  })

  // 3d：404 的那個目標缸從清單移除（它已經不存在了）
  it('404 之後那個目標缸從清單移除，選取一併清掉', async () => {
    state.moveFailure = 404

    const page = await open()

    await openMoveSheet(page)
    await selectTank(page, 'tank-2')
    await confirmMove(page)

    expect(moveOptionIds(page)).toEqual(['tank-3'])
    expect(moveOption(page, 'tank-3').attributes('aria-pressed')).toBe('false')
  })

  // 400 的目標缸仍然存在，沒有理由從清單拿掉
  it('400 之後清單維持原樣', async () => {
    state.moveFailure = 400

    const page = await open()

    await openMoveSheet(page)
    await selectTank(page, 'tank-2')
    await confirmMove(page)

    expect(moveOptionIds(page)).toEqual(['tank-2', 'tank-3'])
  })

  // 「選其他缸」＝回到選擇狀態：錯誤卡片收起來，副標說回「目前在」
  it('按「選其他缸」回到選擇狀態，且不送出任何請求', async () => {
    state.moveFailure = 404

    const page = await open()

    await openMoveSheet(page)
    await selectTank(page, 'tank-2')
    await confirmMove(page)
    await page.get('[data-testid="creature-move-confirm"]').trigger('click')
    await flushPromises()

    expect(page.find('[data-testid="creature-move-error"]').exists()).toBe(false)
    expect(page.get('[data-testid="creature-move-subtitle"]').text()).toContain('目前在')
    expect(page.find('[data-testid="creature-move-confirm"]').exists()).toBe(false)
    expect(state.moveCalls).toBe(1)
  })

  // 其他失敗（離線、5xx、function 掛掉）是「這一次沒送成」，重送有意義
  it('回 500 時出現「重試」，按下去重送同一個目標', async () => {
    state.moveFailure = 500

    const page = await open()

    await openMoveSheet(page)
    await selectTank(page, 'tank-2')
    await confirmMove(page)

    expect(page.get('[data-testid="creature-move-error"]').text()).toContain('珊瑚缸')
    expect(page.get('[data-testid="creature-move-confirm"]').text()).toContain('重試')
    expect(moveOptionIds(page)).toEqual(['tank-2', 'tank-3'])

    state.moveFailure = null

    await confirmMove(page)

    expect(state.moveCalls).toBe(2)
    expect(state.moveBody).toEqual({ tankId: 'tank-2' })
    expect(page.get('[data-testid="creature-current-tank"]').text()).toContain('珊瑚缸')
  })

  // 失敗之後重新開啟 sheet，不該還留著上一次的錯誤卡片
  it('關掉再開，錯誤卡片與選取都清乾淨', async () => {
    state.moveFailure = 404

    const page = await open()

    await openMoveSheet(page)
    await selectTank(page, 'tank-2')
    await confirmMove(page)

    await page.get('[data-testid="creature-move-cancel"]').trigger('click')
    await openMoveSheet(page)

    expect(page.find('[data-testid="creature-move-error"]').exists()).toBe(false)
    expect(moveOptionIds(page)).toEqual(['tank-2', 'tank-3'])
    expect(page.find('[data-testid="creature-move-confirm"]').exists()).toBe(false)
  })
})
