// @vitest-environment node
// 純文字比對，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { blockOf, read, testBlocks } from '../support/spec-source'

// issue #87：`guest-login.spec.ts`「再次進站沿用同一個沙盒」在 main 上必然失敗。
//
// 成因是兩條 spec 對 `/login` 的期待方向相反——#67 之後已登入的人會被 route middleware
// 帶回首頁，那顆「以訪客身分瀏覽」按鈕因此永遠不會出現，`click()` 等到超時。
//
// 要驗的東西本身只有 E2E 跑得出來（要真的有瀏覽器、真的有資料庫），而 E2E 不在 TDD
// Develop 的 job 內執行。所以這裡比對 spec 的原始碼本文，守住三件在修法上很容易失手的事：
//   ① 修完之後那條 test 仍然「再走一遍建立沙盒那條路徑」——只把第二段 goto 刪掉的話，
//      它會退化成第一條 test 的複本，這條 test 就再也不驗任何新東西了（issue 的「A 的代價」）
//   ② 它不再依賴「已登入開得了 /login」——否則換個寫法還是會超時
//   ③ #67 那條反方向的期待原封不動
//
// 這種比對守得住「整段被拿掉或換掉」，守不住「寫錯順序」；後者由 Vercel preview 上的
// `pnpm test:e2e` 收尾（與 auth-wiring.test.ts 同樣的分工）。

// `read` / `testBlocks` / `blockOf` 抽到 ../support/spec-source（issue #95 起共用）

const GUEST_SPEC = 'tests/e2e/guest-login.spec.ts'
const AUTH_GUARD_SPEC = 'tests/e2e/auth-guard.spec.ts'

/** tests/e2e/ 底下所有的 spec */
const SPECS = readdirSync(resolve(process.cwd(), 'tests/e2e'))
  .filter(name => name.endsWith('.spec.ts'))
  .map(name => `tests/e2e/${name}`)

// Given 我已經以訪客身分進站，沙盒裡有一份示範資料 / When 我再次走一遍「建立沙盒」那條路徑
// Then 我看得到的缸 id 與第一次完全相同，沒有多出任何一份示範資料
describe('guest-login.spec.ts —「再次進站沿用同一個沙盒」', () => {
  const TITLE = '再次進站沿用同一個沙盒，不會多長出一份示範資料'

  // 這條 test 唯一的價值是「連建立沙盒的那條路徑都再走一遍」。第二段若改成
  // reload 或單純的 `goto('/')`，走的就只剩讀取路徑，與同檔第一條高度重疊。
  it('仍然再走一遍「建立沙盒」那條路徑', () => {
    expect(blockOf(GUEST_SPEC, TITLE)).toContain('/auth/guest')
  })

  // #67：已登入開 `/login` 會被帶回首頁。第二段只要還經過登入頁的 UI，
  // 那顆訪客按鈕就不會出現，`click()` 必然等到超時——這就是本 issue 的成因。
  it('不再依賴「已登入的人開得了 /login」', () => {
    const block = blockOf(GUEST_SPEC, TITLE)

    // 剩下的那一次是第一段：那時還沒有身分，開得了登入頁
    expect(block.match(/goto\('\/login'\)/g) ?? []).toHaveLength(1)
    expect(block.match(/login-action-guest/g) ?? []).toHaveLength(1)
  })

  // 「沒有多出任何一份示範資料」只有從缸 id 看得出來（訪客的資料歸屬在 API 這一層）。
  // 換成比對畫面標題的話，多長出一份沙盒時標題仍然一模一樣，測不出來。
  it('仍然比對前後看得到的缸 id', () => {
    const block = blockOf(GUEST_SPEC, TITLE)

    expect(block).toContain('tankIds(context)')
    expect(block).toContain('toEqual(before)')
  })
})

// Then guest-login.spec.ts 4 個 test 全部通過
//
// 「通過」本身只有 E2E 驗得到，這裡守的是它的前提：沒有人為了讓它綠而把 test 刪掉。
describe('guest-login.spec.ts 的四條 test 都還在', () => {
  it('仍然是 4 個 test，沒有被刪掉或跳過', () => {
    const source = read(GUEST_SPEC)

    expect(source.match(/^test\(/gm) ?? []).toHaveLength(4)
    expect(source).not.toContain('test.skip')
    expect(source).not.toContain('test.only')
  })
})

// And auth-guard.spec.ts 的「已登入開 /login 會被帶回首頁」仍然通過
//
// 不寫行號：底下是用標題去找那條 test 的，行號只會隨著別人改那支 spec 而愈飄愈遠
// （這行原本寫 :91，在 main 上就已經指到別條了）。
//
// 兩條 spec 互相矛盾時，最省事的「修法」是把 #67 那條一起改掉。這條擋住那個走法。
describe('#67 的行為不被這次修改動到', () => {
  it('auth-guard.spec.ts 仍然期待已登入開 /login 會被帶回首頁', () => {
    const block = blockOf(AUTH_GUARD_SPEC, '已登入開 /login 會被帶回首頁')

    expect(block).toContain('goto(\'/login\')')
    expect(block).toContain('toHaveURL(\'/\')')
  })
})

// 同一個矛盾在別的 spec 裡會長成一模一樣的形狀：先登入，然後再開一次登入頁。
// 只修 guest-login.spec.ts 的話，下一支這樣寫的 spec 會再踩一次同一顆地雷，
// 而且同樣要等到有地方跑 E2E 才看得見（issue #23）。
describe('沒有任何 spec 假設「已登入的人開得了 /login」', () => {
  it.each(SPECS)('%s：同一個 page 不會在沒有登出的情況下再按一次「以訪客身分瀏覽」', (spec) => {
    const offenders = testBlocks(read(spec))
      // 先登出就真的回到未登入，那時登入頁開得起來——這是正當的走法，不算數
      .filter(block => !/logout/i.test(block))
      .flatMap((block) => {
        // 認 `page`、`nextPage` 這種變數名：同一條 test 裡開兩個 context 各按一次是
        // 正當的（兩位不同的訪客），連按兩次的一定是同一個 page
        const pages = [...block.matchAll(/(\w+)\.getByTestId\('login-action-guest'\)/g)]
          .map(match => match[1]!)

        return pages.filter((name, index) => pages.indexOf(name) !== index)
      })

    expect(offenders).toEqual([])
  })
})
