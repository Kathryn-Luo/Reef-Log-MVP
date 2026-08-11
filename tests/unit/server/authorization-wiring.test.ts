// @vitest-environment node
// 純文字比對，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// 「歸屬檢查有沒有真的被接上」（issue #68）。
//
// 判斷本身全在 server/utils/authorization.ts 的純函式裡，由 authorization.test.ts
// 直接呼叫驗證。剩下沒被那一支蓋到的，是 handler 有沒有真的用它——`defineEventHandler`、
// `createError`、`prisma`、`getCurrentUser` 全是 Nitro 的自動匯入，在 vitest 裡
// import 不進來，handler 本身跑不起來，只能看原始碼本文（與 auth-wiring.test.ts 同一個手法）。
//
// 這種比對守得住「整段被拿掉或換掉」，守不住「寫錯順序」。

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

/**
 * 同一份原始碼，但去掉註解。
 *
 * 下面幾條 `not.toMatch` 問的是「這段程式碼還在不在」，而註解本來就會為了解釋
 * 決定而引用它擋掉的寫法（例如「不要寫成 `await readBody(event)`」）。連註解一起比對
 * 的話，把理由寫清楚反而會讓測試轉紅——那會逼著後人刪掉解釋來換一個綠燈。
 */
function readCode(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')
}

/**
 * 遞迴列出 `server/api` 底下所有 handler，路徑一律相對於專案根、以 `/` 分隔。
 *
 * 這一段一定要真的讀檔案系統：只比對「同一個檔案裡宣告的兩份清單」的話，
 * 兩邊會一起對、一起錯，新增一支沒授權的 API 也不會有任何一條測試轉紅。
 */
function listApiHandlers(dir: string): string[] {
  return readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name)

      if (entry.isDirectory()) {
        return listApiHandlers(path)
      }

      return entry.name.endsWith('.ts') ? [path] : []
    })
}

/** 所有資料 API 與各自該用的解析函式（server/api/health.get.ts 不涉及使用者資料，維持公開） */
const HANDLERS = [
  { file: 'server/api/tanks/index.get.ts', resolver: 'resolveTankOptions' },
  { file: 'server/api/tanks/index.post.ts', resolver: 'createOwnedTank' },
  { file: 'server/api/tanks/[id]/home.get.ts', resolver: 'resolveTankHome' },
  { file: 'server/api/tanks/[id]/creatures.get.ts', resolver: 'resolveTankCreatures' },
  { file: 'server/api/tanks/[id]/creatures.post.ts', resolver: 'createOwnedCreature' },
  { file: 'server/api/tanks/[id]/water-logs.get.ts', resolver: 'resolveWaterLogPage' },
  { file: 'server/api/tanks/[id]/water-logs.post.ts', resolver: 'createOwnedWaterLog' },
  { file: 'server/api/tanks/[id]/trends.get.ts', resolver: 'resolveTrendPage' },
  { file: 'server/api/creatures/[id].get.ts', resolver: 'resolveCreatureDetail' },
  { file: 'server/api/creatures/[id].patch.ts', resolver: 'applyCreatureStatus' },
  { file: 'server/api/creatures/[id]/move.patch.ts', resolver: 'moveOwnedCreature' },
  { file: 'server/api/creatures/[id]/profile.patch.ts', resolver: 'updateOwnedCreatureProfile' },
  // 保養提醒（issue #122）：讀取掛在缸底下，兩支寫入掛在任務底下
  { file: 'server/api/tanks/[id]/maintenance.get.ts', resolver: 'resolveMaintenancePage' },
  { file: 'server/api/maintenance-tasks/[id]/completions.post.ts', resolver: 'resolveCompleteTask' },
  { file: 'server/api/maintenance-tasks/[id]/completions/[completedOn].delete.ts', resolver: 'resolveClearCompletion' },
  // 訪客沙盒的補建（issue #144）。不掛在任何缸底下——它要做的事正是「讓這位使用者有缸」
  { file: 'server/api/guest-sandbox.post.ts', resolver: 'resolveGuestSandbox' },
]

describe('每一支 API 都經過同一道歸屬檢查', () => {
  it.each(HANDLERS)('$file 交給 $resolver 決定回傳或拒絕', ({ file, resolver }) => {
    const source = read(file)

    expect(source).toContain(`${resolver}(`)
    // 身分仍然來自 request 上的密封 cookie（#64），不是任何「當前使用者」的替代品
    expect(source).toContain('getCurrentUser(event)')
  })

  // 解析函式回傳的是「描述」，狀態碼要真的變成 HTTP 回應才算數。
  // 少了這一行，被拒絕的請求會安安靜靜地回 200。
  it.each(HANDLERS)('$file 把拒絕的結果丟成 createError', ({ file }) => {
    const source = read(file)

    expect(source).toMatch(/if \(!\w+\.ok\) \{/)
    expect(source).toMatch(/throw createError\(\w+\.error\)/)
  })

  // 每一支都要「自己」判斷，不能有人漏接。這一條是清單本身的守衛：
  // 日後新增 API 時，忘了接上歸屬檢查的那一支會在這裡被抓到。
  //
  // 左邊必須來自檔案系統。原本兩邊都是這個檔案裡的字串字面量，等於拿一份清單
  // 跟它自己比對——新增一支毫無授權的 handler 照樣全綠（實測過），註解卻宣稱
  // 這裡守得住，比沒有這條測試更容易誤導 reviewer。
  it('server/api 底下除了健康檢查之外，沒有不做歸屬檢查的 handler', () => {
    const guarded = HANDLERS.map(handler => handler.file)
    // 健康檢查不涉及使用者資料，維持公開。要新增例外就得動這一行——
    // 那是一個看得見的決定，不是安安靜靜地少接一支。
    const unguarded = ['server/api/health.get.ts']

    expect(listApiHandlers('server/api').sort()).toEqual([...guarded, ...unguarded].sort())
  })

  // 未登入的請求不必、也不該先把整個 request body 收進記憶體。
  //
  // body 寫成 `await readBody(event)` 的參數時，它在解析函式有機會判斷身分**之前**
  // 就已經執行完畢；h3 對畸形 JSON 直接 throw 400，於是完全沒登入的人會拿到
  // 「Bad Request」而不是 401——issue #68 的「未登入一律 401」在這條路徑上不成立。
  it.each([
    'server/api/tanks/index.post.ts',
    'server/api/creatures/[id].patch.ts',
    'server/api/creatures/[id]/move.patch.ts',
    'server/api/creatures/[id]/profile.patch.ts',
    'server/api/tanks/[id]/creatures.post.ts',
    'server/api/tanks/[id]/water-logs.post.ts',
    'server/api/maintenance-tasks/[id]/completions.post.ts',
  ])('%s 把 body 延後到身分檢查之後才讀', (file) => {
    const source = readCode(file)

    expect(source).toMatch(/\(\) => readBody\(event\)/)
    expect(source).not.toMatch(/await readBody\(event\)/)
  })
})

// 上面那條清單守的是「沒有漏接的 handler」，這一條守的是它的反面：
// 唯一的例外要真的維持是例外。unit 這一層原本完全沒有碰過它，只有 E2E 打得到——
// 而 E2E 不在 CI 的 job 內跑，等於健康檢查被誤加上登入要求時，合併前沒有任何一道會紅。
describe('健康檢查維持公開', () => {
  it('server/api/health.get.ts 不讀身分、也不做歸屬檢查', () => {
    const source = readCode('server/api/health.get.ts')

    expect(source).not.toContain('getCurrentUser')
    expect(source).not.toContain('createError')

    for (const { resolver } of HANDLERS) {
      expect(source).not.toContain(resolver)
    }
  })
})

describe('未登入不再是一個看起來正常的空回應', () => {
  // 舊行為：沒有使用者時回 200 `{ tanks: [] }`。前端無法把它與「這個帳號還沒有缸」
  // 分開，$api 的 401 攔截器（#67）也就沒有機會把人帶回登入頁。
  it('GET /api/tanks 不再在無使用者時回傳空清單', () => {
    expect(readCode('server/api/tanks/index.get.ts')).not.toContain('tanks: []')
  })

  // 未登入時把「這個 id 不存在」當答案送出去，等於用 404 掩蓋 401——
  // 人會以為資料不見了，而不是知道自己該重新登入。
  it.each([
    'server/api/tanks/[id]/home.get.ts',
    'server/api/tanks/[id]/creatures.get.ts',
    'server/api/creatures/[id].get.ts',
    'server/api/creatures/[id].patch.ts',
    'server/api/creatures/[id]/move.patch.ts',
  ])('%s 不再用 `user ? ... : null` 把未登入折成 404', (file) => {
    expect(readCode(file)).not.toMatch(/user \?/)
  })
})
