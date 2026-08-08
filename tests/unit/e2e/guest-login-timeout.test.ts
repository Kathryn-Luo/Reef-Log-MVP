// @vitest-environment node
// 純文字比對 + 讀設定值，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it } from 'vitest'
import playwrightConfig from '../../../playwright.config'
import { read } from '../support/spec-source'

// issue #111：「等訪客登入那一次導航完成」用的是全域的 15 秒 expect 預算，而 preview 上
// 這一次導航實測 9.4～14.8 秒（#98）——上限只比觀測值多 0.2 秒，冷啟那幾次必然擦撞。
// `api-authorization.spec.ts` 三條在 CI 上第一次跑就全部倒在同一句、重試才過，
// 是因為它的 beforeAll 要**連續**開兩位訪客，最容易碰到冷的 instance。
//
// 修法是「針對那幾句單獨加碼」，不是把全域的 `expect.timeout` 拉高——後者的代價是
// 每一個真的壞掉的斷言都要多等三倍才回報，而全站只有下面那幾處需要這個預算。
//
// 這支測試守的是「修法有沒有走偏」，不是「E2E 會不會過」（那要 preview 才驗得到）：
//   ① 每一句「按下訪客登入之後等導航完成」都真的拿到加碼過的預算
//   ② 預算來自一個共用的具名常數，不是各處各寫一個數字（會各自漂移）
//   ③ 其餘的斷言仍然用原本的預算——加碼沒有外溢成「全站等更久」
//   ④ 沒有用 issue 明令不准的兩種繞法：`waitForTimeout` 硬等、把斷言改鬆

const SUPPORT = 'tests/e2e/support/guestSession.ts'
const AUTHZ_SPEC = 'tests/e2e/api-authorization.spec.ts'
const AUTH_GUARD_SPEC = 'tests/e2e/auth-guard.spec.ts'
const GUEST_SPEC = 'tests/e2e/guest-login.spec.ts'

/** 共用常數的名字。集中一個名字，數字才不會在四個檔案裡各自漂移。 */
const CONSTANT = 'GUEST_LOGIN_NAV_TIMEOUT_MS'

/**
 * issue 實測的觀測上限：`/auth/guest` 這一次請求最慢的一次（#98 實測 5 次，9.4～14.8 秒）。
 *
 * `toHaveURL('/')` 等的就是這一次導航——不是 #95 那個「登入完 → 首頁有資料」（13.7～21.1 秒），
 * 後者多包了首頁自己去要一次資料。
 */
const SLOWEST_GUEST_LOGIN_NAV_MS = 14_800

/** 全域的兩個預算：這次不准動它們（#95 訂的，各有各的理由） */
const GLOBAL_EXPECT_TIMEOUT_MS = 15_000
const GLOBAL_TEST_TIMEOUT_MS = 90_000

/**
 * 每一句「按下訪客登入之後，等那一次導航完成」的斷言原文。
 *
 * 認的是「觸發（點下那顆訪客按鈕）之後緊接著的第一句 `toHaveURL`」——用位置而不是用
 * 檔名清單來認，之後新增的登入步驟會自動被納進來，不必記得回來改這支測試。
 */
function guestNavAssertions(file: string): string[] {
  const source = read(file)
  const found: string[] = []

  for (const trigger of source.matchAll(/getByTestId\('login-action-guest'\)\s*\.click\(\)/g)) {
    const rest = source.slice(trigger.index + trigger[0].length)
    const assertion = rest.match(/expect\(\w+\)\.toHaveURL\([^\n]*\)/)

    expect(assertion, `${file}：按下訪客登入之後沒有等導航完成`).not.toBeNull()

    found.push(assertion![0])
  }

  return found
}

/** 常數在 guestSession.ts 裡宣告的毫秒數（沒宣告就是 undefined） */
function declaredTimeoutMs(): number | undefined {
  const match = read(SUPPORT).match(new RegExp(`${CONSTANT}\\s*=\\s*([\\d_]+)`))

  return match ? Number(match[1]!.replaceAll('_', '')) : undefined
}

// ── Given preview 上一次訪客登入的導航要 9～15 秒 ──
// ── When  任何一支 E2E 走訪客登入 ──
// ── Then  等待的預算足以涵蓋觀測到的上限，不會在冷啟時擦撞 ──

describe('訪客登入的導航有自己的等待預算', () => {
  it('guestSession.ts 匯出一個具名的共用常數', () => {
    expect(read(SUPPORT)).toMatch(new RegExp(`export const ${CONSTANT}\\b`))
  })

  // 上限只比觀測值多 0.2 秒正是這個 issue 的成因，所以「比 14.8 秒大」還不夠——
  // 要留得下冷啟再慢一次的餘裕。兩倍是「同一個量級再翻一倍」，與 #95 給 beforeAll
  // 加碼時用的算法一致。
  it('預算容得下觀測上限，還留得下冷啟再慢一次的餘裕', () => {
    expect(declaredTimeoutMs()).toBeDefined()
    expect(declaredTimeoutMs()).toBeGreaterThanOrEqual(2 * SLOWEST_GUEST_LOGIN_NAV_MS)
  })

  // 與全域同值等於沒加碼——那就回到 issue 描述的處境了
  it('預算真的比全域的 expect 預算大', () => {
    expect(declaredTimeoutMs()).toBeGreaterThan(playwrightConfig.expect!.timeout!)
  })
})

describe('每一句「等訪客登入完成」都拿到那個預算', () => {
  // 這四處就是 issue 點名的全部：fixture（五支 spec 共 60 條 test 都走）、
  // api-authorization 的 openSandbox、auth-guard「已登入」那一半的 beforeEach、
  // 以及 guest-login 自己那五次登入。
  it.each([
    [SUPPORT, 1],
    [AUTHZ_SPEC, 1],
    [AUTH_GUARD_SPEC, 1],
    [GUEST_SPEC, 5],
  ])('%s 的 %i 處登入等待都帶著共用常數', (file, count) => {
    const assertions = guestNavAssertions(file)

    expect(assertions).toHaveLength(count)

    for (const assertion of assertions) {
      expect(assertion, `${file}：這一句沒有用共用的預算`).toContain(CONSTANT)
    }
  })

  // 各處自己寫一個數字的話，下次調整只會改到其中幾處，其餘的安靜地留在舊值上。
  it.each([AUTHZ_SPEC, AUTH_GUARD_SPEC, GUEST_SPEC])('%s 沒有自己寫死一個毫秒數', (spec) => {
    expect(read(spec)).not.toMatch(/timeout:\s*\d/)
  })

  it.each([AUTHZ_SPEC, AUTH_GUARD_SPEC, GUEST_SPEC])('%s 的常數是從 guestSession 匯入的', (spec) => {
    expect(read(spec)).toMatch(new RegExp(`import \\{[^}]*${CONSTANT}[^}]*\\} from '\\./support/guestSession'`))
  })
})

// ── Given 某個斷言真的失敗了（不是等待不夠）──
// ── When  它在 E2E 裡執行 ──
// ── Then  仍然在原本的預算內回報，不因為這次調整而全站等更久 ──

describe('加碼沒有外溢到全站', () => {
  // 全域拉高的代價是每一個真的壞掉的斷言都要多等三倍才回報。
  it('全域的 expect 預算沒有被動', () => {
    expect(playwrightConfig.expect?.timeout).toBe(GLOBAL_EXPECT_TIMEOUT_MS)
  })

  it('全域的 test 預算沒有被動', () => {
    expect(playwrightConfig.timeout).toBe(GLOBAL_TEST_TIMEOUT_MS)
  })

  // 「單獨加碼」的另一種走偏：順手灑到每一句 toHaveURL 上。那與拉高全域是同一件事，
  // 只是分散寫。所以逐檔數這個常數出現幾次——沒被點名的 spec 一次都不該有。
  //
  // 有登入等待的四支各自是「一次宣告或匯入 + 每一句登入等待各一次」。
  //
  // support 那一支是 1 + 3：#144 之後「登入完成」與「示範資料備妥」是分開的兩段等待
  // ——複製移到了首頁掛載之後的 POST /api/guest-sandbox，`toHaveURL('/')` 通過時
  // 沙盒可能還在路上。後者又拆成「等首頁那一次請求回來」與「輪詢缸清單真的有東西」，
  // 三段都屬於「按下按鈕到真的能用」，用的是同一個預算。
  it.each([
    [SUPPORT, 1 + 3],
    [AUTHZ_SPEC, 1 + 1],
    [AUTH_GUARD_SPEC, 1 + 1],
    [GUEST_SPEC, 1 + 5],
    ['tests/e2e/creature-detail.spec.ts', 0],
    ['tests/e2e/creatures.spec.ts', 0],
    ['tests/e2e/guest-login-timing.spec.ts', 0],
    ['tests/e2e/home.spec.ts', 0],
    ['tests/e2e/login.spec.ts', 0],
    ['tests/e2e/navigation.spec.ts', 0],
    ['tests/e2e/tank-create.spec.ts', 0],
  ])('%s 提到這個預算的次數是 %i', (file, times) => {
    expect(read(file).match(new RegExp(`\\b${CONSTANT}\\b`, 'g')) ?? []).toHaveLength(times)
  })

  // 未登入被導去 /login 等的是 route middleware，不是一次訪客登入。
  // 這幾句跟著加碼的話，#67 那半邊真的壞掉時要多等三倍才說。
  it('auth-guard「未登入」那一半仍然用原本的預算', () => {
    for (const assertion of read(AUTH_GUARD_SPEC).match(/toHaveURL\(\/\\\/login\$\/[^\n]*\)/g) ?? []) {
      expect(assertion).not.toContain(CONSTANT)
    }
  })
})

// ── issue 明令不准的兩種繞法 ──

describe('沒有用繞過的方式讓 E2E 變綠', () => {
  // 硬等在慢的時候一樣會爆、在快的時候白白浪費時間（#95 起就明令不准）
  it.each([SUPPORT, AUTHZ_SPEC, AUTH_GUARD_SPEC, GUEST_SPEC])('%s 沒有用 waitForTimeout 硬等', (file) => {
    expect(read(file)).not.toContain('waitForTimeout')
  })

  // 「等不到就別等了」是最省事的假修法：把 `toHaveURL('/')` 改成正規表達式、
  // 或整句拿掉。少了它，登入失敗會以「登入頁上找不到那個元素」的形式出現——
  // 正是 issue 說的「最花時間查的那一種」失敗形態。
  it.each([SUPPORT, AUTHZ_SPEC, AUTH_GUARD_SPEC, GUEST_SPEC])('%s 等的仍然是精確的首頁網址', (file) => {
    for (const assertion of guestNavAssertions(file)) {
      expect(assertion).toMatch(/toHaveURL\('\/'/)
    }
  })

  // api-authorization 的 beforeAll 依序開兩位訪客，所以它的加碼要跟著這個預算走：
  // 兩次登入各自可以用滿，hook 才不會反過來變成新的天花板。
  it('api-authorization 的 beforeAll 仍然容得下兩次「用滿預算」的登入', () => {
    const hook = read(AUTHZ_SPEC).match(/test\.setTimeout\(\s*([\d_]+)\s*\)/)

    expect(hook, `${AUTHZ_SPEC} 找不到 test.setTimeout`).not.toBeNull()
    expect(Number(hook![1]!.replaceAll('_', ''))).toBeGreaterThanOrEqual(2 * declaredTimeoutMs()!)
  })
})
