// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { createOAuthState, verifyOAuthState } from '../../../server/utils/oauthState'

describe('OAuth state', () => {
  it('每次產生本次請求專屬、可安全放進 URL 的高熵亂數', () => {
    const first = createOAuthState()
    const second = createOAuthState()

    expect(first).not.toBe(second)
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('query 與 cookie 相符時才通過', () => {
    const state = createOAuthState()

    expect(verifyOAuthState(state, state)).toBe(true)
    expect(verifyOAuthState('different', state)).toBe(false)
  })

  it('query 或 cookie 缺少 state 時拒絕', () => {
    expect(verifyOAuthState(undefined, 'cookie-state')).toBe(false)
    expect(verifyOAuthState('query-state', undefined)).toBe(false)
  })

  it('兩邊都是空字串時仍拒絕', () => {
    expect(verifyOAuthState('', '')).toBe(false)
  })
})
