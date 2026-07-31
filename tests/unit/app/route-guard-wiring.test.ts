// @vitest-environment node
// 純文字比對，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// 路由保護的「接線」（issue #67）。
//
// 判斷邏輯在 shared/utils/routeGuard.ts，由 route-guard.test.ts 直接呼叫驗證；
// middleware 與 plugin 各自的行為由 auth-middleware.test.ts 與 tank-new.test.ts 顧。
// 剩下這一層守的是「那些東西有沒有被掛上去」——檔案在不在該在的位置、
// 頁面的 API 呼叫有沒有走過 401 那個關卡。這些沒有可注入的介面，所以看原始碼本文。

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

const MIDDLEWARE = 'app/middleware/auth.global.ts'
const API_PLUGIN = 'app/plugins/api.ts'

/** app/pages 底下所有的 .vue */
function pageSources(dir = 'app/pages'): string[] {
  return readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })
    .flatMap(entry => entry.isDirectory()
      ? pageSources(join(dir, entry.name))
      : entry.name.endsWith('.vue') ? [join(dir, entry.name)] : [])
}

describe('全域 middleware', () => {
  // 檔名結尾的 .global 就是「全域」的開關：少了它，這支 middleware 只會在
  // 有指名 definePageMeta({ middleware }) 的頁面上跑，其餘的頁面一律沒有保護。
  // 那正是「漏掉一頁 = 別人的資料被看見」那種漏法。
  it('掛在 app/middleware/auth.global.ts，對每一頁都生效', () => {
    expect(existsSync(resolve(process.cwd(), MIDDLEWARE))).toBe(true)
    expect(read(MIDDLEWARE)).toContain('defineNuxtRouteMiddleware')
  })

  // 保護不是逐頁貼上去的：頁面自己不必知道這件事，新頁面預設就受保護。
  it('沒有任何頁面自行宣告 auth middleware', () => {
    const offenders = pageSources().filter(file => read(file).includes('middleware:'))

    expect(offenders).toEqual([])
  })
})

describe('401 導向', () => {
  // Story ⑤「Then 我被導向 /login，而不是停在一個一直失敗的畫面上」。
  it('由 app/plugins/api.ts 提供帶 401 攔截的 $api', () => {
    expect(existsSync(resolve(process.cwd(), API_PLUGIN))).toBe(true)

    const source = read(API_PLUGIN)

    expect(source).toContain('onResponseError')
    expect(source).toContain('isUnauthorizedStatus')
    expect(source).toContain('resolveAuthRedirect')
  })

  // 這條是本輪唯一擋得住「下一支 issue 又寫一個裸 $fetch」的地方：
  // 直接呼叫 $fetch 的請求不會經過上面那個攔截器，收到 401 也只會靜靜地失敗，
  // 畫面就停在 issue 說的「一直失敗」的狀態。
  it('頁面一律透過 $api 呼叫 API，沒有繞過攔截器的裸 $fetch', () => {
    const offenders = pageSources().filter((file) => {
      const source = read(file)

      // $api 這個名字本身就含 $fetch 以外的字，比對時要排掉註解裡提到的部分：
      // 只認「呼叫」的形狀（$fetch( / $fetch< / useFetch(）。
      return /\$fetch[(<]/.test(source) || /\buseFetch\(/.test(source)
    })

    expect(offenders).toEqual([])
  })
})
