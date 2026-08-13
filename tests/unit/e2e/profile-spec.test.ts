// @vitest-environment node
// 純文字比對，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it } from 'vitest'
import { read, testBlocks } from '../support/spec-source'
import { PROTECTED_PAGES } from '../../e2e/support/protectedPages'

// issue #169：「訪客走完 Profile 這一趟」的端到端測試。
//
// ── 這支測試證明了什麼、沒證明什麼 ──
//
// Story 要的東西只有 E2E 驗得到（真的部署、真的資料庫、真的 cookie），而 E2E 不在
// TDD Develop 的 job 內執行（跑在 Vercel preview URL 上）。所以這一側與
// auth-guard-spec.test.ts、logged-in-specs.test.ts 同樣比對 spec 的原始碼本文，
// 守住幾件在這條路徑上最容易失手的事：
//   ① 七條 Then 各自有一條 test，沒有整條被漏掉
//   ② 進站是「以訪客身分登入」的共用 fixture，不是自己偽造身分
//   ③ 兩條 403 沒有被鬆成「4xx 就好」，也沒有為了讓 E2E 好寫而被放寬
//      （#166 / #171 的 403 是 Epic #160 刻意的決定，不是待補的缺口）
//   ④ 等的是**正面訊號**（profile-account 真的畫出來）而不是「某個東西不存在」
//      ——後者在 SPA 還沒 mount 的那一拍同樣成立（#129 / #146 的教訓）
//   ⑤ 沒有人為了讓它綠而刪掉、跳過某幾條 test
//
// 守不住的是「斷言本身對不對」，那由 preview 上的 `pnpm test:e2e` 收尾。

const SPEC = 'tests/e2e/profile.spec.ts'
const source = read(SPEC)

/** 七條 Then ↔ 對應那條 test 的標題（順序照 issue 內文） */
const STORIES = [
  ['①進站看得到帳號資訊', '從首頁右上角的 Profile 入口進得了個人資料頁'],
  ['②預設頭像', '訪客的頭像是預設的 circle-user icon'],
  ['③整頁唯讀', '整頁唯讀'],
  ['④改名 403', '訪客直接 PATCH /api/profile 得到 403'],
  ['⑤上傳 403', '訪客直接 POST /api/profile/avatar 得到 403'],
  ['⑥登出', '按下登出回到 /login'],
  ['⑦首頁入口', '首頁右上角的入口是固定的 circle-user icon'],
] as const

/** 標題含 `title` 的那一段 test（沒有就讓斷言自己說是哪一條不見了） */
function blockOf(title: string): string {
  const block = testBlocks(source).find(candidate => candidate.includes(title))

  expect(block, `${SPEC} 找不到「${title}」那一條 test`).toBeDefined()

  return block!
}

/**
 * 去掉註解再看。
 *
 * 底下幾題比對的是「有沒有這句斷言」與「誰排在誰前面」，而說明這件事的註解本身
 * 就會提到那些字串——不去掉的話，量到的是註解，不是斷言。
 * 區塊註解要一起處理：少了那一句，整段斷言被區塊註解包起來之後這裡還是綠的。
 */
const withoutComments = (block: string) =>
  block
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')

describe('七條 Then 各有一條 E2E test', () => {
  it.each(STORIES)('%s 有對應的 test', (_story, title) => {
    expect(blockOf(title)).toBeTruthy()
  })

  it('至少七條 test，沒有兩條 Then 擠在同一條裡', () => {
    expect((source.match(/^[ \t]*test\(/gm) ?? []).length).toBeGreaterThanOrEqual(STORIES.length)
  })
})

// Given 我以訪客身分登入並停在首頁
//
// 身分只能從「真的走一遍訪客登入」來：preview 上唯一登得進去的就是訪客
// （Google 不支援萬用字元 redirect URI）。自己偽造 session 或直接改資料庫，
// 驗到的會是測試塞進去的值，不是這條路徑。
describe('身分來自共用的訪客登入 fixture', () => {
  it('test 是從 support/guestSession 取用的，不是未登入的那個', () => {
    expect(source).toContain('from \'./support/guestSession\'')
  })

  it('沒有偽造身分，也沒有直接碰資料庫或 Blob store', () => {
    for (const forbidden of ['PrismaClient', 'setUserSession', '@vercel/blob', 'prisma.']) {
      expect(source, `E2E 不該出現 ${forbidden}`).not.toContain(forbidden)
    }
  })
})

// Then 進入 /profile，並看到名稱「訪客」、訪客登入方式與加入日期，且沒有 Email 列
describe('①從首頁入口進站', () => {
  const block = () => withoutComments(blockOf(STORIES[0][1]))

  it('是真的按下首頁那個入口，不是自己 goto(\'/profile\')', () => {
    expect(block()).toMatch(/getByTestId\('tank-header-profile'\)[\s\S]{0,40}\.click\(\)/)
    expect(block()).toContain('toHaveURL(\'/profile\')')
  })

  it('等的是「帳號資訊真的畫出來」這個正面訊號，而且排在缺席斷言之前', () => {
    const text = block()
    const positive = text.indexOf('getByTestId(\'profile-account\')')
    const absence = text.indexOf('toHaveCount(0)')

    expect(positive, '找不到等 profile-account 的斷言').toBeGreaterThan(-1)
    expect(absence, '找不到「沒有 Email 列」的斷言').toBeGreaterThan(-1)
    expect(positive).toBeLessThan(absence)
  })

  it('名稱、登入方式、加入日期三項都驗到了', () => {
    const text = block()

    expect(text).toContain('profile-display-name')
    expect(text).toContain('profile-providers')
    expect(text).toContain('profile-created-at')
  })

  it('「沒有 Email 列」驗的是 profile-email 不存在', () => {
    expect(block()).toMatch(/profile-email'\)\)\s*\.toHaveCount\(0\)/)
  })
})

// Then 頭像是預設的 circle-user icon，不是「訪」的首字頭像
describe('②預設頭像', () => {
  const block = () => withoutComments(blockOf(STORIES[1][1]))

  it('先等預設 icon 出現，再確認首字頭像與 img 都不存在', () => {
    const text = block()
    const icon = text.indexOf('profile-avatar-icon')
    const initial = text.indexOf('profile-avatar-initial')

    expect(icon, '找不到等預設 icon 的斷言').toBeGreaterThan(-1)
    expect(initial, '找不到「沒有首字頭像」的斷言').toBeGreaterThan(-1)
    expect(icon).toBeLessThan(initial)
    expect(text).toMatch(/profile-avatar-icon'\)\)\s*\.toBeVisible\(\)/)
    expect(text).toMatch(/profile-avatar-initial'\)\)\s*\.toHaveCount\(0\)/)
  })
})

// Then 名稱旁沒有編輯入口，也沒有「更換頭像」或「移除頭像」——整頁是唯讀的，只有登出可按
describe('③整頁唯讀', () => {
  const block = () => withoutComments(blockOf(STORIES[2][1]))

  it('改名入口與改名表單都不存在', () => {
    const text = block()

    expect(text).toMatch(/profile-name-edit'\)\)\s*\.toHaveCount\(0\)/)
    expect(text).toMatch(/profile-name-form'\)\)\s*\.toHaveCount\(0\)/)
  })

  it('沒有任何檔案選擇欄位（更換頭像的入口一定帶著一個）', () => {
    expect(block()).toContain('input[type="file"]')
  })

  it('「只有登出可按」驗的是帳號區塊裡按得下去的東西剛好一個', () => {
    const text = block()

    expect(text).toMatch(/getByRole\('button'\)/)
    expect(text).toMatch(/toHaveCount\(1\)/)
    expect(text).toContain('profile-logout')
  })
})

// Then 回傳 403，重新整理後名稱仍是「訪客」
describe('④改名被擋在 403', () => {
  const block = () => withoutComments(blockOf(STORIES[3][1]))

  it('送的是一個「合法」的名字——被擋的理由必須是身分，不是格式', () => {
    expect(block()).toMatch(/request\.patch\('\/api\/profile'/)
    expect(block()).toContain('displayName')
  })

  it('斷言的是剛好 403，不是「4xx 就算過」', () => {
    const text = block()

    expect(text).toMatch(/toBe\(403\)/)
    expect(text).not.toMatch(/toBeGreaterThan|toBeLessThan|not\.toBe\(200\)|toBeTruthy/)
  })

  it('之後真的重新整理，並再確認名稱仍是「訪客」', () => {
    const text = block()

    expect(text).toContain('reload()')
    expect(text.indexOf('reload()')).toBeGreaterThan(text.indexOf('toBe(403)'))
    expect(text).toMatch(/profile-display-name'\)\)\s*\.toHaveText\('訪客'\)/)
  })
})

// Then 回傳 403，不建立任何 Blob
describe('⑤上傳被擋在 403', () => {
  const block = () => withoutComments(blockOf(STORIES[4][1]))

  it('送的是一份合法的 PNG——被擋的理由必須是身分，不是檔案', () => {
    const text = block()

    expect(text).toMatch(/request\.post\('\/api\/profile\/avatar'/)
    expect(text).toContain('image/png')
  })

  it('斷言的是剛好 403', () => {
    const text = block()

    expect(text).toMatch(/toBe\(403\)/)
    expect(text).not.toMatch(/toBeGreaterThan|toBeLessThan|not\.toBe\(200\)|toBeTruthy/)
  })

  // 「不建立任何 Blob」在 E2E 這一側看得到的形式，就是「profile 上沒有留下任何頭像網址」
  // ——這支 spec 不碰 Blob store（issue #169 的實作提示），所以沒有別的觀測點。
  it('事後確認 profile 上仍然沒有任何頭像', () => {
    const text = block()

    expect(text).toContain('avatarUrl')
    expect(text).toContain('avatarSource')
  })
})

// Then 回到 /login；此時直接輸入 /profile 會再次被導向 /login
describe('⑥登出', () => {
  const block = () => withoutComments(blockOf(STORIES[5][1]))

  it('是按下畫面上那顆登出，不是自己打 /auth/logout', () => {
    expect(block()).toMatch(/getByTestId\('profile-logout'\)[\s\S]{0,40}\.click\(\)/)
  })

  it('登出後等的是登入頁自己出現，不只是網址變了', () => {
    const text = block()

    expect(text).toMatch(/toHaveURL\(\/\\\/login\$\/\)/)
    expect(text).toMatch(/login-screen'\)\)\s*\.toBeVisible\(\)/)
  })

  it('之後再開一次 /profile，確認又被導回登入頁', () => {
    const text = block()
    const logout = text.indexOf('profile-logout')
    const revisit = text.lastIndexOf('goto(\'/profile\')')

    expect(revisit, '登出之後沒有再開一次 /profile').toBeGreaterThan(logout)
  })
})

// Then 右上角入口是固定的 circle-user icon，不渲染任何 img
describe('⑦首頁的入口', () => {
  const block = () => withoutComments(blockOf(STORIES[6][1]))

  it('先等入口本身出現，再確認它裡面一個 img 都沒有', () => {
    const text = block()
    const positive = text.indexOf('tank-header-profile-icon')
    const absence = text.indexOf('\'img\'')

    expect(positive, '找不到等 icon 出現的斷言').toBeGreaterThan(-1)
    expect(absence, '找不到「沒有 img」的斷言').toBeGreaterThan(-1)
    expect(positive).toBeLessThan(absence)
    expect(text).toMatch(/locator\('img'\)\)\s*\.toHaveCount\(0\)/)
  })

  it('驗到它就是 circle-user 那個 icon，不是任何一個 icon 都算', () => {
    expect(block()).toMatch(/circle-user/)
  })
})

// /profile 早就在受保護頁面那張表上（#164），這一支 E2E 依賴同一個正面標記。
// 兩邊挑不同的標記時，auth-guard 那一組還是綠的，而這裡會等到一個沒人維護的名字。
describe('與受保護頁面那張表用的是同一個正面標記', () => {
  it('/profile 的標記是 profile-account', () => {
    expect(PROTECTED_PAGES.find(page => page.path === '/profile')?.marker).toBe('profile-account')
  })
})

describe('沒有 test 被刪掉或跳過', () => {
  it('沒有被宣告成 skip / fixme / only 的 test', () => {
    expect(source).not.toMatch(/test(?:\.describe)?\.skip\(\s*(['"`]|async)/)
    // fixme 是 Playwright 版的 skip，跳過的效果一樣（skip 那條擋不到它）
    expect(source).not.toMatch(/test(?:\.describe)?\.fixme\(/)
    expect(source).not.toContain('test.only')
    expect(source).not.toContain('test.describe.only')
  })
})
