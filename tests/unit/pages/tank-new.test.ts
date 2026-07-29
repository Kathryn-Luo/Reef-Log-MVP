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
      throw createError({ statusCode: 400, statusMessage: 'Invalid tank input' })
    }

    return { tank: CREATED_TANK }
  },
})

enableAutoUnmount(afterEach)

beforeEach(() => {
  state.body = null
  state.calls = 0
  state.fail = false
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
  it('缸名為必填，尺寸 / 水量 / 飼養型態 / 代表色為選填', async () => {
    const page = await mountForm()

    expect(page.get('input[name="name"]').attributes('required')).toBeDefined()
    for (const optional of ['sizeSpec', 'volumeLiters', 'setupType']) {
      expect(page.get(`input[name="${optional}"]`).attributes('required')).toBeUndefined()
    }

    // 代表色從色票中選，不讓使用者自己打 hex（schema 的 colorHex 存 #RRGGBB）
    expect(page.findAll('[data-testid="tank-color-option"]').length).toBeGreaterThan(0)
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
    })
  })

  it('只填缸名也能送出，其餘欄位為 null', async () => {
    const page = await mountForm()

    await fill(page, { name: '檢疫缸' })
    await submit(page)

    expect(state.body).toMatchObject({
      name: '檢疫缸',
      sizeSpec: null,
      volumeLiters: null,
      setupType: null,
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
})
