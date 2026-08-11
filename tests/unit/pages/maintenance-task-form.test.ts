import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import NewMaintenanceTaskPage from '../../../app/pages/maintenance/tasks/new.vue'
import EditMaintenanceTaskPage from '../../../app/pages/maintenance/tasks/[id]/edit.vue'
import { signedInUserSession } from '../support/session'
import { toLocalDateOnly } from '#shared/utils/maintenance'
import { maxMaintenanceIntervalDays } from '#shared/utils/maintenanceTaskForm'

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))

mockNuxtImport('navigateTo', () => navigateToMock)
mockNuxtImport('useUserSession', () => () => signedInUserSession())

const TASK = {
  id: 'task-1',
  name: '換濾材',
  intervalDays: 14,
  startOn: '2026-08-01',
  createdOn: '2026-07-01',
  displayOrder: 2,
  isActive: true,
  lastCompletion: { completedAt: '2026-08-01T01:00:00.000Z', completedOn: '2026-08-01' },
}

const state = {
  createCalls: 0,
  updateCalls: 0,
  createBody: null as Record<string, unknown> | null,
  updateBody: null as Record<string, unknown> | null,
}

interface MockNodeEvent {
  node: { req: { body?: string } }
}

registerEndpoint('/api/tanks', () => ({
  tanks: [{ id: 'tank-1', name: '主缸', sizeSpec: null, volumeLiters: null, setupType: null, colorHex: null }],
}))

registerEndpoint('/api/guest-sandbox', {
  method: 'POST',
  handler: () => ({ copied: 0, alreadySeeded: true }),
})

registerEndpoint('/api/tanks/tank-1/maintenance-tasks', {
  method: 'POST',
  handler: (event) => {
    state.createCalls += 1
    state.createBody = JSON.parse((event as unknown as MockNodeEvent).node.req.body ?? 'null')
    return { task: { ...TASK, id: 'task-new', ...state.createBody } }
  },
})

registerEndpoint('/api/maintenance-tasks/task-1', {
  method: 'GET',
  handler: () => ({ task: TASK }),
})

registerEndpoint('/api/maintenance-tasks/task-1', {
  method: 'PATCH',
  handler: (event) => {
    state.updateCalls += 1
    state.updateBody = JSON.parse((event as unknown as MockNodeEvent).node.req.body ?? 'null')
    return { task: { ...TASK, ...state.updateBody } }
  },
})

enableAutoUnmount(afterEach)

beforeEach(() => {
  clearNuxtData()
  clearNuxtState()
  navigateToMock.mockReset()
  state.createCalls = 0
  state.updateCalls = 0
  state.createBody = null
  state.updateBody = null
})

async function fill(page: Awaited<ReturnType<typeof mountSuspended>>, name: string, value: string) {
  await page.get(`[name="${name}"]`).setValue(value)
}

describe('/maintenance/tasks/new', () => {
  it('顯示名稱、週期、起算日與啟用開關', async () => {
    const page = await mountSuspended(NewMaintenanceTaskPage, { route: '/maintenance/tasks/new' })

    expect(page.get('[name="name"]').exists()).toBe(true)
    expect(page.findAll('[data-testid="maintenance-interval-option"]').map(option => option.text()))
      .toEqual(['每天', '每週', '每月', '每兩個月', '自訂'])
    expect(page.get('[name="startOn"]').exists()).toBe(true)
    expect(page.get('[data-testid="maintenance-task-active"][role="switch"]').attributes('aria-checked')).toBe('true')
    expect(page.text()).toContain('留白會從建立當天算起')
  })

  it('選每兩個月且起算日留白時建立在目前缸，成功後回保養頁', async () => {
    const page = await mountSuspended(NewMaintenanceTaskPage, { route: '/maintenance/tasks/new' })

    await fill(page, 'name', ' 換活性碳 ')
    await page.get('[data-testid="maintenance-interval-option"][data-interval="60"]').trigger('click')
    await page.get('[data-testid="maintenance-task-form"]').trigger('submit')
    await flushPromises()

    expect(state.createCalls).toBe(1)
    expect(state.createBody).toEqual({
      name: '換活性碳',
      intervalDays: 60,
      startOn: null,
      isActive: true,
      localCreatedOn: toLocalDateOnly(new Date()),
    })
    expect(navigateToMock).toHaveBeenCalledWith('/maintenance')
  })

  it.each(['0', '-3', '1.5'])('自訂週期 %s 不合法時顯示錯誤且不寫入', async (intervalDays) => {
    const page = await mountSuspended(NewMaintenanceTaskPage, { route: '/maintenance/tasks/new' })

    await fill(page, 'name', '換水')
    await page.get('[data-testid="maintenance-interval-option"][data-interval="custom"]').trigger('click')
    await fill(page, 'intervalDays', intervalDays)
    await page.get('[data-testid="maintenance-task-form"]').trigger('submit')

    expect(state.createCalls).toBe(0)
    expect(page.get('[data-testid="maintenance-task-error"]').text()).toContain('正整數')
  })
})

describe('/maintenance/tasks/:id/edit', () => {
  it('帶入名稱、自訂週期、起算日與啟用狀態', async () => {
    const page = await mountSuspended(EditMaintenanceTaskPage, { route: '/maintenance/tasks/task-1/edit' })

    expect(page.get('[name="name"]').element.value).toBe('換濾材')
    expect(page.get('[data-testid="maintenance-interval-option"][data-interval="custom"]').attributes('aria-pressed')).toBe('true')
    expect(page.get('[name="intervalDays"]').element.value).toBe('14')
    expect(page.get('[name="intervalDays"]').attributes('max'))
      .toBe(String(maxMaintenanceIntervalDays(TASK.lastCompletion.completedOn)))
    expect(page.get('[name="startOn"]').element.value).toBe('2026-08-01')
    expect(page.get('[data-testid="maintenance-task-active"][role="switch"]').attributes('aria-checked')).toBe('true')
  })

  it('修改週期並停用後 PATCH，成功時回保養頁', async () => {
    const page = await mountSuspended(EditMaintenanceTaskPage, { route: '/maintenance/tasks/task-1/edit' })

    await page.get('[data-testid="maintenance-interval-option"][data-interval="30"]').trigger('click')
    await page.get('[data-testid="maintenance-task-active"][role="switch"]').trigger('click')
    await page.get('[data-testid="maintenance-task-form"]').trigger('submit')
    await flushPromises()

    expect(state.updateCalls).toBe(1)
    expect(state.updateBody).toEqual({ name: '換濾材', intervalDays: 30, startOn: '2026-08-01', isActive: false })
    expect(navigateToMock).toHaveBeenCalledWith('/maintenance')
  })
})
