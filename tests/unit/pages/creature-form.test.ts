import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import CreatureProfileForm from '../../../app/components/CreatureProfileForm.vue'
import NewCreaturePage from '../../../app/pages/creatures/new.vue'
import EditCreaturePage from '../../../app/pages/creatures/[id]/edit.vue'
import { signedInUserSession } from '../support/session'

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))

mockNuxtImport('navigateTo', () => navigateToMock)
mockNuxtImport('useUserSession', () => () => signedInUserSession())

const state = {
  createBody: null as Record<string, unknown> | null,
  updateBody: null as Record<string, unknown> | null,
  createCalls: 0,
  updateCalls: 0,
  sandboxCalls: 0,
  tanksReady: true,
}

interface MockNodeEvent {
  node: { req: { body?: string } }
}

const CREATURE = {
  id: 'creature-1',
  tankId: 'tank-1',
  tankName: '主缸',
  name: '火焰仙',
  scientificName: 'Centropyge loriculus',
  category: 'FISH',
  subCategory: '神仙',
  status: 'ALIVE',
  photoUrl: null,
  addedOn: '2026-08-01',
  price: 1280.5,
  ailment: null,
  observedSickOn: null,
  diedOn: null,
  causeOfDeath: null,
  deathNote: null,
} as const

registerEndpoint('/api/tanks', () => ({
  tanks: state.tanksReady
    ? [
        { id: 'tank-1', name: '主缸', sizeSpec: null, volumeLiters: null, setupType: null, colorHex: null },
        { id: 'tank-2', name: '珊瑚缸', sizeSpec: null, volumeLiters: null, setupType: null, colorHex: null },
      ]
    : [],
}))

registerEndpoint('/api/guest-sandbox', {
  method: 'POST',
  handler: () => {
    state.sandboxCalls += 1
    state.tanksReady = true
    return { copied: 1, alreadySeeded: false }
  },
})

registerEndpoint('/api/tanks/tank-2/creatures', {
  method: 'POST',
  handler: (event) => {
    state.createCalls += 1
    state.createBody = JSON.parse((event as unknown as MockNodeEvent).node.req.body ?? 'null')
    return { creature: { ...CREATURE, id: 'creature-new', tankId: 'tank-2', tankName: '珊瑚缸', ...state.createBody } }
  },
})

registerEndpoint('/api/creatures/creature-1', () => ({ creature: CREATURE }))

registerEndpoint('/api/creatures/creature-1/profile', {
  method: 'PATCH',
  handler: (event) => {
    state.updateCalls += 1
    state.updateBody = JSON.parse((event as unknown as MockNodeEvent).node.req.body ?? 'null')
    return { creature: { ...CREATURE, ...state.updateBody } }
  },
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  clearNuxtData()
  clearNuxtState()
  state.createBody = null
  state.updateBody = null
  state.createCalls = 0
  state.updateCalls = 0
  state.sandboxCalls = 0
  state.tanksReady = true
  navigateToMock.mockReset()
})

async function fill(page: Awaited<ReturnType<typeof mountSuspended>>, values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    await page.get(`[name="${name}"]`).setValue(value)
  }
}

describe('/creatures/new', () => {
  it('訪客示範資料尚未備妥時先補建並刷新缸清單', async () => {
    state.tanksReady = false

    const page = await mountSuspended(NewCreaturePage, { route: '/creatures/new' })
    for (let attempt = 0; attempt < 10 && !page.find('[data-testid="creature-profile-form"]').exists(); attempt++) {
      await flushPromises()
    }

    expect(state.sandboxCalls).toBe(1)
    expect(page.find('[data-testid="creature-profile-form"]').exists()).toBe(true)
    expect(page.text()).not.toContain('還沒有任何缸')
  })

  it('顯示六個基本資料欄位，不出現照片、狀態或刪除操作', async () => {
    const page = await mountSuspended(NewCreaturePage, { route: '/creatures/new?tank=tank-2' })

    expect(page.findAll('[data-testid="creature-profile-field"]').map(field => field.attributes('data-field')))
      .toEqual(['name', 'scientificName', 'category', 'subCategory', 'addedOn', 'price'])
    expect(page.text()).not.toContain('上傳照片')
    expect(page.text()).not.toContain('刪除生物')
    expect(page.find('[data-testid="status-option"]').exists()).toBe(false)
  })

  it('俗名、分類、入缸日未齊時 canSubmit 為 false，填齊後才可儲存', async () => {
    const page = await mountSuspended(NewCreaturePage, { route: '/creatures/new?tank=tank-2' })

    expect(page.get('[data-testid="creature-profile-submit"]').attributes('disabled')).toBeDefined()

    await fill(page, { name: '火焰仙', addedOn: '2026-08-01' })
    await page.get('[data-testid="creature-category-option"][data-category="FISH"]').trigger('click')

    expect(page.get('[data-testid="creature-profile-submit"]').attributes('disabled')).toBeUndefined()
  })

  it('送出正規化後的資料到網址指定的目前缸，成功後進入新生物詳情', async () => {
    const page = await mountSuspended(NewCreaturePage, { route: '/creatures/new?tank=tank-2' })

    await fill(page, {
      name: '  火焰仙  ',
      scientificName: ' Centropyge loriculus ',
      subCategory: ' 神仙 ',
      addedOn: '2026-08-01',
      price: '1280.50',
    })
    await page.get('[data-testid="creature-category-option"][data-category="FISH"]').trigger('click')
    await page.get('[data-testid="creature-profile-form"]').trigger('submit')
    await flushPromises()

    expect(state.createCalls).toBe(1)
    expect(state.createBody).toEqual({
      name: '火焰仙',
      scientificName: 'Centropyge loriculus',
      category: 'FISH',
      subCategory: '神仙',
      addedOn: '2026-08-01',
      price: 1280.5,
      timeZoneOffsetMinutes: new Date().getTimezoneOffset(),
    })
    expect(navigateToMock).toHaveBeenCalledWith('/creatures/creature-new')
  })

  it('未來日期顯示在表單唯一的錯誤位置，且不呼叫 API', async () => {
    const page = await mountSuspended(NewCreaturePage, { route: '/creatures/new?tank=tank-2' })

    await fill(page, { name: '火焰仙', addedOn: '2999-01-01' })
    await page.get('[data-testid="creature-category-option"][data-category="FISH"]').trigger('click')
    await page.get('[data-testid="creature-profile-form"]').trigger('submit')

    expect(state.createCalls).toBe(0)
    expect(page.findAll('[data-testid="creature-profile-error"]')).toHaveLength(1)
    expect(page.get('[data-testid="creature-profile-error"]').text()).toContain('不能晚於今天')
  })
})

describe('CreatureProfileForm', () => {
  it('頁面跨過本地午夜時更新入缸日上限', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 11, 23, 59, 59, 900))

    const form = mount(CreatureProfileForm, {
      props: { title: '新增生物', backTo: '/creatures' },
    })
    await form.vm.$nextTick()

    expect(form.get('[name="addedOn"]').attributes('max')).toBe('2026-08-11')

    await vi.advanceTimersByTimeAsync(200)
    await form.vm.$nextTick()

    expect(form.get('[name="addedOn"]').attributes('max')).toBe('2026-08-12')
  })
})

describe('/creatures/:id/edit', () => {
  it('載入後帶入六個欄位的現有值', async () => {
    const page = await mountSuspended(EditCreaturePage, { route: '/creatures/creature-1/edit' })

    expect(page.get('[name="name"]').element.value).toBe('火焰仙')
    expect(page.get('[name="scientificName"]').element.value).toBe('Centropyge loriculus')
    expect(page.get('[data-testid="creature-category-option"][data-category="FISH"]').attributes('aria-pressed')).toBe('true')
    expect(page.get('[name="subCategory"]').element.value).toBe('神仙')
    expect(page.get('[name="addedOn"]').element.value).toBe('2026-08-01')
    expect(page.get('[name="price"]').element.value).toBe('1280.5')
  })

  it('改名後 PATCH profile，成功時回到該生物詳情頁', async () => {
    const page = await mountSuspended(EditCreaturePage, { route: '/creatures/creature-1/edit' })

    await fill(page, { name: '新名字' })
    await page.get('[data-testid="creature-profile-form"]').trigger('submit')
    await flushPromises()

    expect(state.updateCalls).toBe(1)
    expect(state.updateBody).toMatchObject({ name: '新名字', category: 'FISH', addedOn: '2026-08-01' })
    expect(state.updateBody).not.toHaveProperty('status')
    expect(navigateToMock).toHaveBeenCalledWith('/creatures/creature-1')
  })
})
