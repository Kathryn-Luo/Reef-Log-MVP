import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import ProfilePage from '../../../app/pages/profile.vue'
import { signedInUserSession } from '../support/session'

mockNuxtImport('useUserSession', () => () => signedInUserSession())

interface MockNodeEvent {
  node: { req: { body?: string } }
}

const GOOGLE_PROFILE = {
  displayName: '陳彥廷',
  email: 'yenting@gmail.com',
  providers: ['GOOGLE'],
  createdAt: '2025-03-18T04:00:00.000Z',
  avatarUrl: 'https://example.test/google.png',
  avatarSource: 'google',
} as const

const state = {
  profile: { ...GOOGLE_PROFILE } as Record<string, unknown>,
  getFailure: false,
  patchFailure: null as string | null,
  patchCalls: 0,
  patchBody: null as Record<string, unknown> | null,
}

registerEndpoint('/api/profile', {
  method: 'GET',
  handler: () => {
    if (state.getFailure) {
      throw createError({ statusCode: 500, statusMessage: 'Profile failed' })
    }

    return state.profile
  },
})

registerEndpoint('/api/profile', {
  method: 'PATCH',
  handler: (event) => {
    state.patchCalls += 1
    state.patchBody = JSON.parse((event as unknown as MockNodeEvent).node.req.body ?? 'null')

    if (state.patchFailure) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid display name',
        data: { message: state.patchFailure },
      })
    }

    state.profile = { ...state.profile, displayName: state.patchBody?.displayName }
    return state.profile
  },
})

enableAutoUnmount(afterEach)

beforeEach(() => {
  clearNuxtData()
  clearNuxtState()
  state.profile = { ...GOOGLE_PROFILE }
  state.getFailure = false
  state.patchFailure = null
  state.patchCalls = 0
  state.patchBody = null
})

async function open() {
  const page = await mountSuspended(ProfilePage, { route: '/profile' })
  await flushPromises()
  return page
}

async function startEditing(page: Awaited<ReturnType<typeof open>>) {
  await page.get('[data-testid="profile-name-edit"]').trigger('click')
}

describe('/profile', () => {
  it('顯示 Google 使用者的頭像、名稱、Email、登入方式與加入日期，Email 沒有編輯入口', async () => {
    const page = await open()

    expect(page.get('[data-testid="profile-avatar-image"]').attributes('src')).toBe(GOOGLE_PROFILE.avatarUrl)
    expect(page.get('[data-testid="profile-display-name"]').text()).toBe('陳彥廷')
    expect(page.get('[data-testid="profile-email"]').text()).toContain('yenting@gmail.com')
    expect(page.get('[data-testid="profile-providers"]').text()).toContain('Google 登入')
    expect(page.get('[data-testid="profile-created-at"]').text()).toMatch(/2025.*03.*18/)
    expect(page.find('input[name="email"]').exists()).toBe(false)
  })

  it('訪客顯示首字與訪客登入，不渲染空白 Email 列', async () => {
    state.profile = {
      ...GOOGLE_PROFILE,
      displayName: '訪客',
      email: null,
      providers: ['GUEST'],
      avatarUrl: null,
      avatarSource: 'none',
    }

    const page = await open()

    expect(page.get('[data-testid="profile-avatar-initial"]').text()).toBe('訪')
    expect(page.get('[data-testid="profile-providers"]').text()).toContain('訪客')
    expect(page.find('[data-testid="profile-email"]').exists()).toBe(false)
  })

  it('改名成功後更新畫面，沒有照片時首字也同步更新', async () => {
    state.profile = {
      ...GOOGLE_PROFILE,
      displayName: '訪客',
      email: null,
      providers: ['GUEST'],
      avatarUrl: null,
      avatarSource: 'none',
    }
    const page = await open()
    await startEditing(page)

    await page.get('input[name="displayName"]').setValue(' 小明 ')
    await page.get('[data-testid="profile-name-form"]').trigger('submit')
    await flushPromises()

    expect(state.patchCalls).toBe(1)
    expect(state.patchBody).toEqual({ displayName: '小明' })
    expect(page.get('[data-testid="profile-display-name"]').text()).toBe('小明')
    expect(page.get('[data-testid="profile-avatar-initial"]').text()).toBe('小')
  })

  it('空白或超過 30 字時顯示原因，不送出請求', async () => {
    const page = await open()
    await startEditing(page)

    await page.get('input[name="displayName"]').setValue('魚'.repeat(31))
    await page.get('[data-testid="profile-name-form"]').trigger('submit')

    expect(state.patchCalls).toBe(0)
    expect(page.get('[data-testid="profile-name-error"]').text()).toContain('30')
    expect(page.get('[data-testid="profile-name-count"]').text()).toBe('31 / 30')
  })

  it('取消編輯時回到原名，不送出請求', async () => {
    const page = await open()
    await startEditing(page)

    await page.get('input[name="displayName"]').setValue('改到一半')
    await page.get('[data-testid="profile-name-cancel"]').trigger('click')

    expect(state.patchCalls).toBe(0)
    expect(page.get('[data-testid="profile-display-name"]').text()).toBe('陳彥廷')
  })

  it('改名 API 失敗時顯示可讀訊息，畫面仍是原名', async () => {
    state.patchFailure = '這個名稱目前無法使用。'
    const page = await open()
    await startEditing(page)

    await page.get('input[name="displayName"]').setValue('新名字')
    await page.get('[data-testid="profile-name-form"]').trigger('submit')
    await flushPromises()

    expect(page.get('[data-testid="profile-name-error"]').text()).toContain('這個名稱目前無法使用')
    expect(page.get('[data-testid="profile-display-name"]').text()).toBe('陳彥廷')
  })

  it('登出使用既有 POST /auth/logout，由 server redirect 回 login', async () => {
    const page = await open()
    const form = page.get('[data-testid="profile-logout-form"]')

    expect(form.attributes('method')).toBe('post')
    expect(form.attributes('action')).toBe('/auth/logout')
    expect(form.get('[data-testid="profile-logout"]').attributes('type')).toBe('submit')
  })

  it('GET profile 失敗時顯示整頁載入失敗，不渲染空白帳號資料', async () => {
    state.getFailure = true
    const page = await open()

    expect(page.find('[data-testid="load-error"]').exists()).toBe(true)
    expect(page.find('[data-testid="profile-account"]').exists()).toBe(false)
  })
})
