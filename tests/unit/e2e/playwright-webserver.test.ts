// @vitest-environment node
// 讀設定值 + 讀 package.json，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// issue #23：E2E 的兩條執行路徑在 playwright.config.ts 裡由 PLAYWRIGHT_BASE_URL 分岔——
// 有值走 Vercel preview URL（不起本機 server），沒值才 fallback 去起 dev server。
// 而那個 fallback 寫的是 `npm run dev`，本專案用的卻是 pnpm（package.json 的
// packageManager 欄位鎖定 pnpm@10）。preview 那條路不會踩到，所以一直沒露餡，
// 但本機 `pnpm test:e2e` 會用錯的套件管理器起 server。
//
// 這支守的是「分岔本身」：兩條路各自的行為都要有斷言，否則修其中一條時
// 另一條會無聲地跟著壞掉。

const CONFIG_MODULE = '../../../playwright.config'

const packageJson = () =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
    packageManager?: string
    scripts?: Record<string, string>
  }

const ORIGINAL_BASE_URL = process.env.PLAYWRIGHT_BASE_URL

/** 以指定的 PLAYWRIGHT_BASE_URL 重新載入設定；傳 undefined 代表「這個變數沒設」。 */
async function loadConfig(baseUrl: string | undefined) {
  if (baseUrl === undefined) delete process.env.PLAYWRIGHT_BASE_URL
  else process.env.PLAYWRIGHT_BASE_URL = baseUrl

  // config 在 module top-level 就讀掉 process.env，所以要清掉 module cache 才會重讀
  vi.resetModules()

  return (await import(CONFIG_MODULE)).default
}

afterEach(() => {
  if (ORIGINAL_BASE_URL === undefined) delete process.env.PLAYWRIGHT_BASE_URL
  else process.env.PLAYWRIGHT_BASE_URL = ORIGINAL_BASE_URL

  vi.resetModules()
})

// ── Given 本機開發（沒有 PLAYWRIGHT_BASE_URL）／When 跑 pnpm test:e2e ──

describe('沒有 PLAYWRIGHT_BASE_URL 時，fallback 用本專案的套件管理器起 dev server', () => {
  // Then：起 server 的指令用 pnpm，不是 npm
  it('webServer 的指令是 pnpm，不是 npm 或 yarn', async () => {
    const config = await loadConfig(undefined)

    expect(config.webServer, '沒有 PLAYWRIGHT_BASE_URL 時應該要 fallback 起本機 server').toBeDefined()
    expect(config.webServer.command).toMatch(/^pnpm\b/)
    expect(config.webServer.command).not.toMatch(/\b(npm|yarn)\b/)
  })

  // 「改成 pnpm」有個假達成：指令換了但指向一個不存在的 script，
  // 於是 fallback 一樣起不來——只是換一種方式壞。
  it('指令跑的是 package.json 裡真的有的 script', async () => {
    const config = await loadConfig(undefined)
    const script = config.webServer.command.replace(/^pnpm\s+(run\s+)?/, '').trim()

    expect(Object.keys(packageJson().scripts ?? {})).toContain(script)
  })

  // 這是「該用 pnpm」的依據本身：packageManager 換了的話，上面兩條要跟著改。
  it('package.json 宣告的套件管理器就是 pnpm', () => {
    expect(packageJson().packageManager).toMatch(/^pnpm@/)
  })

  // Then：server 起在 config 自己用的 baseURL 上，Playwright 才等得到正確的位址
  it('等待的位址與 baseURL 是同一個', async () => {
    const config = await loadConfig(undefined)

    expect(config.webServer.url).toBe(config.use.baseURL)
  })
})

// ── Given CI 上已注入 preview URL／When 跑 pnpm test:e2e ──

describe('有 PLAYWRIGHT_BASE_URL 時，直接打那個 URL，不起本機 server', () => {
  const PREVIEW_URL = 'https://reef-log-git-feat-23-dev.vercel.app'

  // Then：baseURL 就是注入的 preview URL
  it('baseURL 採用注入的值', async () => {
    const config = await loadConfig(PREVIEW_URL)

    expect(config.use.baseURL).toBe(PREVIEW_URL)
  })

  // Then：不啟動任何本機 dev server
  // 這條路上 runner 沒有資料庫也沒有 .env，真去起 nuxt dev 只會白等到逾時。
  it('完全不設定 webServer', async () => {
    const config = await loadConfig(PREVIEW_URL)

    expect(config.webServer).toBeUndefined()
  })
})
