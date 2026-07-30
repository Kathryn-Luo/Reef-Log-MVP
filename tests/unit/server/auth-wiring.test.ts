// @vitest-environment node
// 純文字比對，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// 「接線」的守備範圍（issue #64）。
//
// Story 裡真正有分支的邏輯全都在 server/utils 的純函式裡，由 session.test.ts、
// google-login.test.ts、current-context.test.ts 三支直接呼叫驗證。剩下沒被那三支
// 蓋到的，是「那些函式有沒有真的被接上」——路由存不存在、cookie 是用哪個寫入方式、
// handler 拿的是不是 request 上的身分。這些沒有可注入的介面（`defineOAuthGoogleEventHandler`、
// `replaceUserSession` 全是 Nitro 自動匯入），所以這裡看原始碼本文。
//
// 這種比對守得住「整段被拿掉或換掉」，守不住「寫錯順序」。後者靠人工在
// localhost:3000/auth/google 驗證——Google 的 redirect URI 不支援萬用字元，
// preview deployment 上那段流程本來就走不完（Epic #47 的硬約束）。

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

const GOOGLE_ROUTE = 'server/routes/auth/google.get.ts'
const LOGOUT_ROUTE = 'server/routes/auth/logout.post.ts'

/** server/ 底下所有的 .ts，用來做「整個 server 端都沒有某段程式碼」這種掃描 */
function serverSources(dir = 'server'): string[] {
  return readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })
    .flatMap(entry => entry.isDirectory()
      ? serverSources(join(dir, entry.name))
      : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : [])
}

/** issue #64「呼叫端共六支（main 上核對）」 */
const HANDLERS = [
  'server/api/tanks/index.get.ts',
  'server/api/tanks/index.post.ts',
  'server/api/tanks/[id]/home.get.ts',
  'server/api/tanks/[id]/creatures.get.ts',
  'server/api/creatures/[id].get.ts',
  'server/api/creatures/[id].patch.ts',
]

describe('Google 登入路由', () => {
  // 登入頁的「使用 Google 繼續」是 external 連結，指向 /auth/google（#63 已定案的路徑）。
  // 檔案不在這個位置的話，按下去會是 404，而 login.test.ts 只驗得到 href 本身。
  it('掛在登入頁按鈕指向的 /auth/google', () => {
    expect(existsSync(resolve(process.cwd(), GOOGLE_ROUTE))).toBe(true)
    expect(read('app/pages/login.vue')).toContain('\'/auth/google\'')
  })

  it('用 defineOAuthGoogleEventHandler 完成 OAuth 握手', () => {
    expect(read(GOOGLE_ROUTE)).toContain('defineOAuthGoogleEventHandler')
  })

  // Google userinfo 的回應在型別上是 any；先過 toGoogleProfile 再交給 Prisma
  it('profile 先經過 toGoogleProfile，再交給 resolveGoogleLogin 查／建帳號', () => {
    const source = read(GOOGLE_ROUTE)

    expect(source).toContain('toGoogleProfile')
    expect(source).toContain('resolveGoogleLogin')
  })

  // Story ①「And 發出密封 cookie，內容只有 { userId, exp }」
  //
  // 一定要 replace 不能 set：setUserSession 是 defu 合併（見套件的 session.js），
  // 前一位使用者留下的欄位會原封不動留在新 cookie 裡，內容就不再「只有 userId 與 exp」。
  // buildSessionPayload 的回傳值也就白挑那兩個欄位了。
  it('以 replaceUserSession 寫入 buildSessionPayload 的內容，不用會合併舊值的 setUserSession', () => {
    const source = read(GOOGLE_ROUTE)

    expect(source).toContain('buildSessionPayload')
    expect(source).toContain('replaceUserSession(')
    // 比對呼叫形狀而不是裸字串：註解裡點名了 setUserSession，說明為什麼不能用它
    expect(source).not.toContain('setUserSession(')
  })
})

describe('登出路由', () => {
  // Story ⑤「Then cookie 被清除，之後的請求一律視為未登入」
  it('清除 session cookie', () => {
    expect(existsSync(resolve(process.cwd(), LOGOUT_ROUTE))).toBe(true)
    expect(read(LOGOUT_ROUTE)).toContain('clearUserSession')
  })

  // POST 之後導向要用 303 See Other。302 能動是因為瀏覽器歷史上把它當 303 處理，
  // 規範上「換一個方法去取另一個資源」是 303 的定義。
  it('以 303 導回登入頁', () => {
    expect(read(LOGOUT_ROUTE)).toContain('303')
  })
})

// 設定壞掉（NUXT_SESSION_PASSWORD 沒設或不足 32 字元）時，h3 的 seal 會直接拋錯。
// 沒有隔離的話，那不是「大家都沒登入」，而是**每一支 API 都 500**——包含首頁。
// 這兩條守的是「認證的失敗不會擴散成全站故障」。
describe('認證失敗的隔離', () => {
  it('讀 session 失敗時退回未登入，而不是讓整個請求炸掉', () => {
    const source = read('server/utils/authContext.ts')

    expect(source).toContain('catch')
    expect(source).toContain('return null')
  })

  // 資料庫在登入這一刻出問題、或 P2002 重查後仍拋出時，使用者該回到登入頁重試，
  // 而不是看到一頁 500。套件的 onError 接不到這一段——它只管到 OAuth 握手為止。
  it('onSuccess 內的查／建帳號失敗時導回登入頁', () => {
    const source = read(GOOGLE_ROUTE)

    expect(source).toContain('catch')
    expect(source.match(/sendRedirect\(event, '\/login'\)/g) ?? []).not.toHaveLength(0)
  })
})

describe('當前使用者的來源', () => {
  // Story ③「Then 取到的是 cookie 中 userId 對應的那一位，而不是 createdAt 最早的那一位」
  //
  // 認證導入前的暫時實作是 `findFirst({ orderBy: { createdAt: 'asc' } })`。它一旦留著，
  // 任何一支 handler 不小心用回去就等於全站共用同一位使用者——這是本 issue 要根除的東西。
  // 掃整個 server/ 而不是只看 currentContext.ts：這條要守的是「這個查詢在 server 端
  // 任何角落都不該再出現」，只讀一個檔的話，換個檔案寫回去就溜過去了。
  it('server 端不再有「取最早建立的那一位使用者」的查詢', () => {
    // 認得的是 `user.findFirst` 這個呼叫，不是 `orderBy: { createdAt: 'asc' }`——
    // 後者在別處是正當的（生物依入缸順序排列，見 creatureList.ts、homeData.ts），
    // 拿它當特徵只會把無關的查詢一起判有罪。
    //
    // 也不比對「createdAt」這幾個字：註解裡留著「而不是 createdAt 最早的那一位」，
    // 那句話正是這條測試要守住的意思，不該把測試自己絆倒。
    const offenders = serverSources().filter(file => read(file).includes('user.findFirst'))

    expect(offenders).toEqual([])
  })

  it.each(HANDLERS)('%s 以 request 上的 session 決定身分', (handler) => {
    const source = read(handler)

    // 舊寫法 getCurrentUser(prisma) 完全不看 request，換誰來都是同一位
    expect(source).not.toContain('getCurrentUser(prisma)')
    expect(source).toContain('getCurrentUser(event)')
  })
})

describe('nuxt.config.ts', () => {
  it('註冊 nuxt-auth-utils', () => {
    expect(read('nuxt.config.ts')).toContain('nuxt-auth-utils')
  })

  // CLAUDE.md 的硬約束：Prisma 6 是非 edge 寫法，preset 落到 vercel-edge 會 crash。
  // 這一輪動了 nuxt.config.ts，順手把它釘住。
  it('nitro preset 仍為 vercel（Node），不是 vercel-edge', () => {
    const source = read('nuxt.config.ts')

    expect(source).toContain('preset: \'vercel\'')
    // 同樣比對設定本身：註解裡就寫著「非 vercel-edge」
    expect(source).not.toContain('preset: \'vercel-edge\'')
  })
})
