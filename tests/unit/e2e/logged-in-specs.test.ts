// @vitest-environment node
// 純文字比對，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// issue #80：#64 拿掉「一律取 createdAt 最早的那一位使用者」之後，未登入的請求拿不到
// 任何資料，而 home / creatures / creature-detail / navigation / tank-create 這五支
// spec 全部是直接 `page.goto('/')` 進站——#67 之後它們會停在登入頁，一條都跑不完。
//
// 修法是「補一個登入步驟」，粒度採 issue 建議的 A：**每個 test 各自以訪客身分登入**，
// 各自拿到一份沙盒（#66 的訪客登入會複製一份模板示範資料）。B（globalSetup +
// storageState）與 C（worker-scoped fixture）省的是資料庫列數，付出的是測試之間互相
// 干擾——那正是 #66 選擇獨立沙盒要解決的問題。
//
// ── 這支測試證明了什麼、沒證明什麼 ──
//
// 「58 個 test 全部通過」本身只有 E2E 驗得到（要真的有瀏覽器、真的有資料庫），而 E2E
// 不在 TDD Develop 的 job 內執行、也還沒有地方跑（#23）。所以這裡與
// guest-login-spec.test.ts 同樣比對 spec 的原始碼本文，守住幾件在修法上最容易失手的事：
//   ① 五支 spec 真的接上了登入步驟，而不是只改了其中幾支
//   ② 登入是「每個 test 一次」，沒有偷偷退回共用沙盒的做法（B / C）
//   ③ 沒有人為了讓它綠而刪掉、跳過某幾條 test
//   ④ 反方向的三支（login / auth-guard / api-authorization）與自己走登入的
//      guest-login 沒有被順手加上自動登入——那會把它們驗的「未登入」前提整個抽掉
//
// 守不住的是「寫錯順序」與「斷言本身對不對」，那些由 Vercel preview 上的 `pnpm test:e2e`
// 收尾（與 auth-wiring.test.ts、guest-login-spec.test.ts 同樣的分工）。

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

const SUPPORT = 'tests/e2e/support/guestSession.ts'
const CONFIG = 'playwright.config.ts'

/**
 * 需要登入才跑得完的五支，與各自現有的 test 數。
 *
 * 數字是「不准變少」的錨點，不是規格：加 test 時把它一起加上去即可，減少則要先問
 * 為什麼。issue 內文寫的是 58（32 / 9 / 8 / 4 / 5），實際數到的 home 是 34——
 * issue 寫下之後 home.spec.ts 又多了兩條，總數因此是 60。以現況為準。
 */
const LOGGED_IN_SPECS = [
  ['tests/e2e/home.spec.ts', 34],
  ['tests/e2e/creatures.spec.ts', 9],
  ['tests/e2e/creature-detail.spec.ts', 8],
  ['tests/e2e/navigation.spec.ts', 4],
  ['tests/e2e/tank-create.spec.ts', 5],
  // 記錄水質（#124）。這一支寫入水質記錄，同樣要有身分才進得去，
  // 所以一起納入這份名單——新加的 spec 漏接 fixture 會紅在這裡。
  ['tests/e2e/water-log.spec.ts', 5],
  // 保養提醒（#125）。勾選 / 取消會寫進自己的沙盒，同樣要有身分。
  ['tests/e2e/maintenance.spec.ts', 5],
  // 移動到其他缸（#120）。真的把生物換到另一個缸，寫入同樣落在自己的沙盒裡。
  ['tests/e2e/creature-move.spec.ts', 2],
  // 新增／編輯生物基本資料（#16）。兩條都會寫進各自的訪客沙盒。
  ['tests/e2e/creature-form.spec.ts', 2],
  // 新增／編輯／停用保養任務（#17）。每條都會寫進各自的訪客沙盒。
  ['tests/e2e/maintenance-task-form.spec.ts', 3],
] as const

/**
 * 不該被自動登入碰到的四支。
 *
 * login 驗的是登入頁本身（前提正是「未登入」）、auth-guard 與 api-authorization 各自
 * 有「未登入」那一半、guest-login 與 guest-login-timing 驗的就是訪客登入這條路徑本身
 * ——五支都自己管理身分。
 */
const SELF_MANAGED_SPECS = [
  'tests/e2e/login.spec.ts',
  'tests/e2e/auth-guard.spec.ts',
  'tests/e2e/api-authorization.spec.ts',
  'tests/e2e/guest-login.spec.ts',
  'tests/e2e/guest-login-timing.spec.ts',
]

/**
 * `test` 這個名字是從哪個模組 import 進來的。
 *
 * 只認具名的值 import：`import type { Page } from '@playwright/test'` 是型別，
 * 五支 spec 仍然會有，不代表它們用的是未登入的那個 `test`。
 */
function testImportedFrom(source: string): string | null {
  for (const [, type, names, specifier] of source.matchAll(/^import\s+(type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/gm)) {
    if (type) {
      continue
    }

    const imported = names!.split(',').map(name => name.trim().split(/\s+as\s+/)[0])

    if (imported.includes('test')) {
      return specifier!
    }
  }

  return null
}

/** 一支 spec 裡的 test 條數（`test.describe` / `test.use` 不算） */
const testCount = (source: string) => (source.match(/^[ \t]*test\(/gm) ?? []).length

// Given preview 的資料庫已跑過 prisma/seed.ts
// When  執行 pnpm test:e2e
// Then  五支 spec 的 test 全部通過（這裡守的是它的前提：每一支都真的先登入了）
describe('五支需要登入的 spec 都接上訪客登入', () => {
  it.each(LOGGED_IN_SPECS)('%s 的 test 來自共用的訪客登入 fixture', (spec) => {
    expect(testImportedFrom(read(spec))).toBe('./support/guestSession')
  })

  // 直接 `page.goto('/')` 進站正是本 issue 的成因。fixture 已經把人帶到首頁，
  // spec 內部要去哪一頁仍由自己決定，所以這裡不管 goto，只管「有沒有身分」。
  it.each(LOGGED_IN_SPECS)('%s 不再從 @playwright/test 取用未登入的 test', (spec) => {
    expect(testImportedFrom(read(spec))).not.toBe('@playwright/test')
  })
})

// And 每個 test 看到的是自己那份示範資料，不是別的 test 留下的狀態
//
// 「自己那一份」的機制是：每個 test 各自走一遍訪客登入 → #66 各複製一份模板沙盒。
describe('訪客登入的粒度是「每個 test 一次」', () => {
  it('fixture 走的是登入頁上那顆「以訪客身分瀏覽」，並確認停在首頁', () => {
    const source = read(SUPPORT)

    expect(source).toContain('goto(\'/login\')')
    expect(source).toContain('login-action-guest')
    // 這一句 #111 之後多帶了一個等待預算（`toHaveURL('/', { timeout: … })`），
    // 所以認的是「等的仍然是精確的首頁網址」而不是整串字面值。
    // 那個預算本身由 guest-login-timeout.test.ts 顧著。
    expect(source).toMatch(/toHaveURL\('\/'[,)]/)
  })

  // auto fixture：五支 spec 裡「之後才加的」test 也會自動有身分，不必記得補一行。
  // 少了它，新 test 會以未登入的狀態跑，而且同樣要等到有地方跑 E2E 才看得見（#23）。
  it('fixture 是每個 test 自動跑的，不是要各 spec 自己記得呼叫', () => {
    expect(read(SUPPORT)).toContain('auto: true')
  })

  // 做法 C：worker-scoped 的 fixture 會讓同一個 worker 內的 test 共用一個沙盒，
  // 而 fullyParallel 下「誰跟誰同 worker」不可預期——干擾會變成偶發失敗。
  it('fixture 不是 worker-scoped', () => {
    expect(read(SUPPORT)).not.toContain('scope: \'worker\'')
  })

  // 做法 B：globalSetup + storageState 是「全部共用一個沙盒」，
  // tank-create 建的缸會被 home 看到——正是 #52 原本的問題。
  it('playwright.config.ts 沒有共用登入狀態的設定', () => {
    const config = read(CONFIG)

    expect(config).not.toContain('storageState')
    expect(config).not.toContain('globalSetup')
  })
})

// Given 任兩個 test 各自建立或修改了缸 / When 它們並行執行
// Then 彼此的斷言都不受對方影響
//
// 隔離來自「一人一個沙盒」（上一組），這裡守的是另一半：並行本身沒有被關掉。
// 把 fullyParallel 關成 false 也能讓互相干擾的測試變綠，那是拿掉症狀不是解決成因。
describe('並行沒有被關掉', () => {
  it('playwright.config.ts 仍然 fullyParallel', () => {
    expect(read(CONFIG)).toContain('fullyParallel: true')
  })
})

// 「補登入步驟」不該順手改動斷言：既有斷言本來就不必改（訪客沙盒是模板的忠實複製，
// 「主缸 · 4 尺」這些內容在沙盒裡一模一樣），所以 test 條數只准增不准減。
describe('沒有 test 被刪掉或跳過', () => {
  it.each(LOGGED_IN_SPECS)('%s 至少還有原本那些 test', (spec, count) => {
    expect(testCount(read(spec))).toBeGreaterThanOrEqual(count)
  })

  // 認的是「宣告成 skip」的那兩種寫法：`test.skip('標題', …)` 與 `test.skip(async …)`。
  // home.spec.ts 裡 `test.skip(browserName !== 'chromium', …)` 是 test 內部的條件跳過
  // （Input.dispatchTouchEvent 只有 Chromium 的 CDP 有），那是正當的，不算作弊。
  it.each(LOGGED_IN_SPECS)('%s 沒有被宣告成 skip / only 的 test', (spec) => {
    const source = read(spec)

    expect(source).not.toMatch(/test(?:\.describe)?\.skip\(\s*(['"`]|async)/)
    expect(source).not.toContain('test.only')
    expect(source).not.toContain('test.describe.only')
  })
})

// Given login.spec.ts 驗的是未登入時的登入頁
// When  執行 pnpm test:e2e
// Then  它仍然不經過登入，5 個 test 全部通過
describe('login.spec.ts 仍然是未登入的', () => {
  const LOGIN_SPEC = 'tests/e2e/login.spec.ts'

  it('用的是原本未登入的 test，沒有被換成訪客登入的 fixture', () => {
    expect(testImportedFrom(read(LOGIN_SPEC))).toBe('@playwright/test')
  })

  // 它會斷言那顆按鈕的文案與 href，所以「有沒有提到 login-action-guest」不具鑑別力，
  // 要看的是有沒有真的按下去。
  it('沒有按下「以訪客身分瀏覽」', () => {
    expect(read(LOGIN_SPEC)).not.toMatch(/login-action-guest'\)\s*\.?\s*\n?\s*\.click\(/)
  })

  it('仍然是 5 個 test', () => {
    expect(testCount(read(LOGIN_SPEC))).toBe(5)
  })
})

// login 以外還有三支自己管理身分的 spec，一起守住——它們被加上自動登入時，
// 失敗的方式是「未登入」那一半安靜地變成「已登入」，斷言卻照樣寫著 401。
describe('自己管理身分的四支沒有被自動登入接管', () => {
  it.each(SELF_MANAGED_SPECS)('%s 的 test 仍來自 @playwright/test', (spec) => {
    expect(testImportedFrom(read(spec))).toBe('@playwright/test')
  })
})
