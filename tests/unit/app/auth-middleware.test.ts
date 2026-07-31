import type { RouteLocationNormalized } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import authGuard from '../../../app/middleware/auth.global'
import { SESSION_MAX_AGE_SECONDS } from '../../../server/utils/session'

// 全域路由 middleware 的接線（issue #67）。
//
// 「該不該導向」的每一個分支都在 route-guard.test.ts 驗過了，這一支顧的是
// 剩下那一半：middleware 有沒有把「當前路徑」與「cookie 裡的身分」餵給那個判斷，
// 以及有沒有真的把 navigateTo 的結果回傳出去（漏掉 return 的話，router 不會接手，
// 人會停在原本那一頁）。

const { navigateToMock, sessionState } = vi.hoisted(() => ({
  navigateToMock: vi.fn(),
  // useUserSession().session 是一個 ref；middleware 只讀 .value
  sessionState: { value: null as unknown },
}))

mockNuxtImport('navigateTo', () => navigateToMock)
mockNuxtImport('useUserSession', () => () => ({ session: sessionState }))

/** middleware 只看 path，其餘欄位不影響判斷 */
function route(path: string): RouteLocationNormalized {
  return { path } as RouteLocationNormalized
}

function signIn(secondsUntilExpiry = SESSION_MAX_AGE_SECONDS) {
  sessionState.value = {
    userId: 'user-1',
    exp: Math.floor(Date.now() / 1000) + secondsUntilExpiry,
  }
}

function run(path: string) {
  return authGuard(route(path), route('/'))
}

beforeEach(() => {
  navigateToMock.mockReset()
  navigateToMock.mockReturnValue('redirect-result')
  // 未登入時 /api/_auth/session 回的是空物件
  sessionState.value = {}
})

describe('未登入', () => {
  // Given 我沒有登入 / When 我開啟首頁 / Then 我被導向 /login
  it('開首頁時導向 /login', () => {
    run('/')

    expect(navigateToMock).toHaveBeenCalledWith('/login', { replace: true })
  })

  // Given 我沒有登入 / When 我開啟 /log、/trends、/creatures、/creatures/<id>、
  // /maintenance、/tanks/new 其中任何一頁 / Then 我被導向 /login
  it.each([
    '/log',
    '/trends',
    '/creatures',
    '/creatures/f5',
    '/maintenance',
    '/tanks/new',
  ])('開 %s 時導向 /login', (path) => {
    run(path)

    expect(navigateToMock).toHaveBeenCalledWith('/login', { replace: true })
  })

  it('開 /login 與 /auth/* 時不攔', () => {
    run('/login')
    run('/auth/google')

    expect(navigateToMock).not.toHaveBeenCalled()
  })

  // 少了 return，router 收不到那個導向指令：畫面會停在原地，
  // 使用者看到的就是 issue 裡說的「半個空殼畫面」。
  it('把導向的結果回傳給 router', () => {
    expect(run('/')).toBe('redirect-result')
  })

  it('不需要導向時什麼都不回傳', () => {
    expect(run('/login')).toBeUndefined()
  })
})

describe('已登入', () => {
  // Given 我已登入 / When 我開啟上述任何需要資料的頁面 / Then 正常顯示，不會被導向 /login
  it.each(['/', '/log', '/trends', '/creatures', '/creatures/f5', '/maintenance', '/tanks/new'])(
    '開 %s 時不導向',
    (path) => {
      signIn()

      run(path)

      expect(navigateToMock).not.toHaveBeenCalled()
    },
  )

  // Given 我已登入 / When 我開啟 /login / Then 我被導向首頁
  it('開 /login 時導回首頁', () => {
    signIn()

    run('/login')

    expect(navigateToMock).toHaveBeenCalledWith('/', { replace: true })
  })

  // 導向一律 replace：留在歷史紀錄裡的話，按上一頁會回到那個「不該停留」的頁面，
  // 然後又被導走一次——上一頁就此按不動。
  it('導向時用 replace，不留下按不動的上一頁', () => {
    signIn()

    run('/login')

    expect(navigateToMock).toHaveBeenCalledWith(expect.anything(), { replace: true })
  })
})

describe('session 已過期', () => {
  // 有 cookie 但內容已經過期，等同未登入。權威的判定在 server 端
  // （server/utils/session.ts 的 readSessionPayload），這裡只是讓畫面不要先亮出來。
  it('視為未登入，開首頁時導向 /login', () => {
    signIn(-1)

    run('/')

    expect(navigateToMock).toHaveBeenCalledWith('/login', { replace: true })
  })
})
