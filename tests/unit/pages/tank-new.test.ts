import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import NewTankPage from '../../../app/pages/tanks/new.vue'
import type { TankOption } from '#shared/types/home'

// 建立缸的表單（issue #46）。
//
// Given 我在建立缸的表單
// When  我填入缸名（必填）與尺寸 / 水量 / 飼養型態 / 代表色（選填）並送出
// Then  建立一個屬於我的 Tank … And 導回首頁，該缸成為當前缸

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))

mockNuxtImport('navigateTo', () => navigateToMock)

const CREATED_TANK: TankOption = {
  id: 'tank-new',
  name: '主缸',
  sizeSpec: '4 尺',
  volumeLiters: 420,
  setupType: 'SPS MIXED',
  colorHex: '#2dd4bf',
}

const state = {
  /** 這一輪 POST /api/tanks 收到的 body */
  body: null as Record<string, unknown> | null,
  calls: 0,
  fail: false,
  /** 這一輪要讓 API 回哪一種失敗（fail 為 true 時才看） */
  failure: { statusCode: 400, statusMessage: 'Invalid tank input', message: null as string | null },
}

/**
 * registerEndpoint 底下跑的是 h3 的 node listener，$fetch 送出的 body
 * 原樣掛在 node 請求物件上（node-mock-http 的行為）。
 */
interface MockNodeEvent {
  node: { req: { body?: string } }
}

registerEndpoint('/api/tanks', {
  method: 'POST',
  handler: (event) => {
    state.calls += 1
    state.body = JSON.parse((event as unknown as MockNodeEvent).node.req.body ?? 'null')

    if (state.fail) {
      // 與 server/api/tanks/index.post.ts 同一個形狀：statusMessage 只留 ASCII，
      // 可以給使用者看的中文訊息放在 data.message
      throw createError({
        statusCode: state.failure.statusCode,
        statusMessage: state.failure.statusMessage,
        data: state.failure.message === null ? undefined : { message: state.failure.message },
      })
    }

    return { tank: CREATED_TANK }
  },
})

enableAutoUnmount(afterEach)

beforeEach(() => {
  state.body = null
  state.calls = 0
  state.fail = false
  state.failure = { statusCode: 400, statusMessage: 'Invalid tank input', message: null }
  navigateToMock.mockReset()
})

function mountForm() {
  return mountSuspended(NewTankPage, { route: '/tanks/new' })
}

async function fill(
  page: Awaited<ReturnType<typeof mountForm>>,
  values: Record<string, string>,
) {
  for (const [name, value] of Object.entries(values)) {
    await page.get(`input[name="${name}"]`).setValue(value)
  }
}

async function submit(page: Awaited<ReturnType<typeof mountForm>>) {
  await page.get('[data-testid="tank-form"]').trigger('submit')
  await flushPromises()
}

describe('建立缸的表單 — 欄位', () => {
  it('缸名為必填，其餘欄位皆為選填', async () => {
    const page = await mountForm()

    expect(page.get('input[name="name"]').attributes('required')).toBeDefined()
    for (const optional of ['sizeSpec', 'volumeLiters', 'setupType', 'colorHex', 'startedOn']) {
      expect(page.get(`input[name="${optional}"]`).attributes('required')).toBeUndefined()
    }

    expect(page.findAll('[data-testid="tank-color-option"]').length).toBeGreaterThan(0)
  })

  // 設計稿的欄位由上到下：缸名 → 代表色 → 尺寸標示 → 水量 → 飼養型態 → 開缸日期
  it('欄位順序與設計稿一致', async () => {
    const page = await mountForm()

    expect(
      page.findAll('[data-testid="tank-field"]').map(field => field.attributes('data-field')),
    ).toEqual(['name', 'colorHex', 'sizeSpec', 'volumeLiters', 'setupType', 'startedOn'])
  })

  // 設計稿：缸名旁有「必填」徽章，其餘欄位不得看起來像必填
  it('只有缸名標示「必填」', async () => {
    const page = await mountForm()

    const required = page.findAll('[data-testid="tank-field-required"]')

    expect(required).toHaveLength(1)
    expect(required[0]!.text()).toBe('必填')
    expect(page.get('[data-testid="tank-field"][data-field="name"]').text()).toContain('必填')
  })

  // 設計稿：開缸日期是日期選擇器，說明文字為「作為缸齡計算依據」
  it('開缸日期是日期選擇器，並說明它的用途', async () => {
    const page = await mountForm()
    const field = page.get('[data-testid="tank-field"][data-field="startedOn"]')

    expect(field.get('input[name="startedOn"]').attributes('type')).toBe('date')
    expect(field.text()).toContain('作為缸齡計算依據')
  })

  // 設計稿：水量欄位右側標出單位「公升 / L」，飼養型態下方給例子
  it('水量標出單位，飼養型態給出例子', async () => {
    const page = await mountForm()

    expect(page.get('[data-testid="tank-field"][data-field="volumeLiters"]').text()).toContain('公升')
    expect(page.get('[data-testid="tank-field"][data-field="setupType"]').text()).toContain('SPS MIXED')
  })

  it('點擊色票即選中該色，同一時間只有一個被選中', async () => {
    const page = await mountForm()
    const swatches = page.findAll('[data-testid="tank-color-option"]')

    await swatches[2]!.trigger('click')

    const pressed = page
      .findAll('[data-testid="tank-color-option"]')
      .filter(swatch => swatch.attributes('aria-pressed') === 'true')

    expect(pressed).toHaveLength(1)
    expect(pressed[0]!.attributes('data-color')).toBe(swatches[2]!.attributes('data-color'))
  })

  // 設計稿：色票之外還有「自訂色碼」輸入框，兩邊是同一個值
  it('點色票會把色碼填進自訂色碼欄位', async () => {
    const page = await mountForm()
    const swatches = page.findAll('[data-testid="tank-color-option"]')

    await swatches[1]!.trigger('click')

    expect(page.get('input[name="colorHex"]').element.value)
      .toBe(swatches[1]!.attributes('data-color'))
  })

  it('自訂色碼填的若正好是某個色票，該色票呈選中態', async () => {
    const page = await mountForm()
    const target = page.findAll('[data-testid="tank-color-option"]')[3]!.attributes('data-color')!

    await page.get('input[name="colorHex"]').setValue(target.toUpperCase())

    const pressed = page
      .findAll('[data-testid="tank-color-option"]')
      .filter(swatch => swatch.attributes('aria-pressed') === 'true')

    expect(pressed).toHaveLength(1)
    expect(pressed[0]!.attributes('data-color')).toBe(target)
  })

  // 設計稿：選色結果即時反映在標題列左側的色塊上
  it('標題列的色塊即時反映選到的代表色', async () => {
    const page = await mountForm()

    expect(page.get('[data-testid="tank-color-preview"]').attributes('data-color')).toBeUndefined()

    const swatches = page.findAll('[data-testid="tank-color-option"]')
    await swatches[1]!.trigger('click')

    expect(page.get('[data-testid="tank-color-preview"]').attributes('data-color'))
      .toBe(swatches[1]!.attributes('data-color'))
  })
})

describe('建立缸的表單 — 儲存按鈕', () => {
  // 設計稿：標題列右上角與表單底部各有一個「儲存」，缸名為空時 disabled
  it('缸名為空時兩個儲存按鈕都 disabled，並提示先填缸名', async () => {
    const page = await mountForm()

    for (const testId of ['tank-form-submit', 'tank-header-submit']) {
      expect(page.get(`[data-testid="${testId}"]`).attributes('disabled')).toBeDefined()
    }

    expect(page.get('[data-testid="tank-form-hint"]').text()).toContain('請先填寫缸名')
  })

  it('填了缸名之後兩個儲存按鈕都可按，提示消失', async () => {
    const page = await mountForm()

    await fill(page, { name: '主缸' })

    for (const testId of ['tank-form-submit', 'tank-header-submit']) {
      expect(page.get(`[data-testid="${testId}"]`).attributes('disabled')).toBeUndefined()
    }

    expect(page.find('[data-testid="tank-form-hint"]').exists()).toBe(false)
  })

  // 只填空白不算填了缸名
  it('缸名只填空白時仍然 disabled', async () => {
    const page = await mountForm()

    await fill(page, { name: '   ' })

    expect(page.get('[data-testid="tank-form-submit"]').attributes('disabled')).toBeDefined()
  })

  it('標題列的「儲存」也會送出表單', async () => {
    const page = await mountForm()

    await fill(page, { name: '主缸' })
    await page.get('[data-testid="tank-header-submit"]').trigger('click')
    await flushPromises()

    expect(state.calls).toBe(1)
  })
})

describe('建立缸的表單 — 送出', () => {
  // Then 建立一個屬於我的 Tank
  it('把填好的欄位送到 POST /api/tanks', async () => {
    const page = await mountForm()

    await fill(page, {
      name: '  主缸  ',
      sizeSpec: '4 尺',
      volumeLiters: '420',
      setupType: 'SPS MIXED',
      startedOn: '2025-11-12',
    })
    await page.findAll('[data-testid="tank-color-option"]')[1]!.trigger('click')

    const chosenColor = page
      .findAll('[data-testid="tank-color-option"]')[1]!
      .attributes('data-color')

    await submit(page)

    expect(state.calls).toBe(1)
    expect(state.body).toEqual({
      name: '主缸',
      sizeSpec: '4 尺',
      volumeLiters: 420,
      setupType: 'SPS MIXED',
      colorHex: chosenColor,
      startedOn: '2025-11-12',
    })
  })

  it('只填缸名也能送出，其餘欄位為 null', async () => {
    const page = await mountForm()

    await fill(page, { name: '檢疫缸' })
    await submit(page)

    expect(state.body).toEqual({
      name: '檢疫缸',
      sizeSpec: null,
      volumeLiters: null,
      setupType: null,
      // 設計稿的新增缸畫面預設沒有選色（左上角色塊是空的虛線框）
      colorHex: null,
      startedOn: null,
    })
  })

  // And 導回首頁，該缸成為當前缸
  it('建立成功後帶著新缸的 id 導回首頁', async () => {
    const page = await mountForm()

    await fill(page, { name: '主缸' })
    await submit(page)

    expect(navigateToMock).toHaveBeenCalledWith({ path: '/', query: { tank: 'tank-new' } })
  })

  it('缸名沒填時不送出，並顯示錯誤訊息', async () => {
    const page = await mountForm()

    await submit(page)

    expect(state.calls).toBe(0)
    expect(navigateToMock).not.toHaveBeenCalled()
    expect(page.get('[data-testid="tank-form-error"]').text()).toContain('缸名')
  })

  it('水量填了不是正整數的值時不送出', async () => {
    const page = await mountForm()

    await fill(page, { name: '主缸', volumeLiters: '-5' })
    await submit(page)

    expect(state.calls).toBe(0)
    expect(page.get('[data-testid="tank-form-error"]').exists()).toBe(true)
  })

  it('API 失敗時留在表單並顯示錯誤，不導頁', async () => {
    state.fail = true

    const page = await mountForm()

    await fill(page, { name: '主缸' })
    await submit(page)

    expect(navigateToMock).not.toHaveBeenCalled()
    expect(page.get('[data-testid="tank-form-error"]').exists()).toBe(true)
  })

  // API 把可以直接顯示的訊息放在 data.message（statusMessage 只留 ASCII，h3 會濾掉中文）。
  // 不讀它的話，「沒有可用的使用者」這種說得出原因的失敗會被蓋成一句無用的通用訊息。
  it('API 說明了失敗原因時，原樣顯示那則訊息', async () => {
    state.fail = true
    state.failure = {
      statusCode: 401,
      statusMessage: 'No current user',
      message: '目前沒有可用的使用者，無法決定這個缸屬於誰。',
    }

    const page = await mountForm()

    await fill(page, { name: '主缸' })
    await submit(page)

    expect(navigateToMock).not.toHaveBeenCalled()
    expect(page.get('[data-testid="tank-form-error"]').text()).toBe(
      '目前沒有可用的使用者，無法決定這個缸屬於誰。',
    )
  })

  // 連不上、逾時、500——說不出原因時仍然要有話可說
  it('API 沒有說明原因時退回通用訊息', async () => {
    state.fail = true
    state.failure = { statusCode: 500, statusMessage: 'Internal Server Error', message: null }

    const page = await mountForm()

    await fill(page, { name: '主缸' })
    await submit(page)

    expect(page.get('[data-testid="tank-form-error"]').text()).toBe('建立失敗，請稍後再試。')
  })

  // 缸這時候已經建好了。把導頁一起包在 try 裡的話，導頁被中止會顯示「建立失敗」，
  // 使用者照著重送就會建出第二個一模一樣的缸。
  it('建立成功之後導頁失敗，不會回報成建立失敗', async () => {
    navigateToMock.mockRejectedValueOnce(new Error('navigation aborted'))

    const page = await mountForm()

    await fill(page, { name: '主缸' })
    await submit(page)

    expect(state.calls).toBe(1)
    expect(page.find('[data-testid="tank-form-error"]').exists()).toBe(false)
  })
})
