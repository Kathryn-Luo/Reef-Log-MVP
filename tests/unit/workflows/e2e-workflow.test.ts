// @vitest-environment node
// 純文字比對，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// issue #23：E2E 一直沒有地方執行。#80 的 58 條（實際 60 條）失敗因此躺了好幾天，
// 沒有任何 CI 訊號會紅——「沒有地方跑」與「跑了但都過」在 PR 上看起來一模一樣。
//
// 這支比照 ci-checks.test.ts，驗的是 workflow 定義本身的結構性不變量，
// 尤其是那些一旦被悄悄放寬，E2E 就會退回「永遠綠燈」或「根本沒跑」的地方。
// workflow 實際跑得起來與否只有 GitHub Actions 驗得到，那是第一次 run 的事。

const workflowPath = resolve(process.cwd(), '.github/workflows/e2e.yml')

const raw = () => readFileSync(workflowPath, 'utf8')

/** 剝掉整行註解：註解裡會引述指令與條件本身，純文字比對會誤中散文。 */
const code = (text: string) =>
  text
    .split('\n')
    .filter(line => !/^\s*#/.test(line))
    .join('\n')

/** 取出頂層 key（縮排 0）與其後續的整個區塊。 */
function topLevel(key: string): string | undefined {
  const lines = code(raw()).split('\n')
  const index = lines.findIndex(line => line.startsWith(`${key}:`))
  if (index === -1) return undefined
  const collected = [lines[index]!.slice(`${key}:`.length)]
  for (const line of lines.slice(index + 1)) {
    if (/^\S/.test(line)) break
    collected.push(line)
  }
  return collected.join('\n')
}

/** 把 job 底下的步驟切開，一個元素一個步驟。 */
function steps(): string[] {
  return code(raw())
    .split(/^ {6}- (?=name:|uses:|run:|id:)/m)
    .slice(1)
}

/** 某個步驟的 `run:` 內容（單行或區塊）。 */
function runOf(step: string): string {
  const lines = step.split('\n')
  const index = lines.findIndex(line => /^ {8}run:/.test(line))
  if (index === -1) return ''
  const collected = [lines[index]!.replace(/^ {8}run:/, '')]
  for (const line of lines.slice(index + 1)) {
    if (line.trim() !== '' && !/^ {10}/.test(line)) break
    collected.push(line)
  }
  return collected.join('\n')
}

/**
 * 這個步驟有沒有執行某個 pnpm script。
 * `(\s|$)` 的邊界是必要的：少了它，`pnpm test` 會誤中 `pnpm test:e2e`（反之亦然）。
 */
const runsScript = (step: string, script: string) =>
  new RegExp(`(^|\\s)pnpm ${script}(\\s|$)`, 'm').test(runOf(step))

const stepRunning = (script: string) => steps().find(step => runsScript(step, script))

/** `if:` 那一段（job 層級，縮排 4）。 */
const jobCondition = () => code(raw()).match(/^ {4}if: >-\n([\s\S]*?)\n {4}\S/m)?.[1] ?? ''

describe('e2e.yml：對 Vercel preview 跑 Playwright', () => {
  it('workflow 檔案存在', () => {
    expect(existsSync(workflowPath), '找不到 .github/workflows/e2e.yml').toBe(true)
  })

  // 解析器壞掉時，下面一票斷言會集體真空通過。先釘住結構。
  it('解析得出步驟', () => {
    expect(steps().length).toBeGreaterThan(0)
  })

  // Given preview deployment 就緒 / When Vercel 回報部署狀態 / Then E2E 自動執行
  //
  // 換成 pull_request 的話就得自己輪詢等 preview 好——沒有 URL 的那段時間裡，
  // 測試不是紅的，是連不上的。
  it('由 deployment_status 觸發', () => {
    expect(topLevel('on')).toMatch(/deployment_status/)
  })
})

// ── 「有沒有真的跑到」的防線 ──
//
// 這一組守的不是斷言強度，而是「這支 workflow 到底有沒有執行 E2E」。
// 條件寫錯時 GitHub 只會顯示 skipped，PR 上看起來與「跑完沒事」幾乎沒有差別。
describe('觸發條件挑得出「該跑的那一次」', () => {
  // deployment_status 在 pending / in_progress / success / failure 都會發。
  // 少了這個條件，preview 還在 build 的那次也會進來，然後對一個還不存在的 URL 跑測試。
  it('只在部署成功的那一次跑', () => {
    expect(jobCondition()).toMatch(/deployment_status\.state\s*==\s*'success'/)
  })

  // 環境要用白名單，不能用「排除 Production」的黑名單。
  //
  // `deployment_status` 不是 Vercel 專屬的事件——本 repo 的 `tdd-develop.yml` 掛著
  // `environment: agent`，它每次跑都會發一個同樣的事件。黑名單放它過去之後，
  // E2E 會對著一個空的 URL 跑，然後在沒有資料庫的 runner 上等到逾時（見 #23 的留言）。
  //
  // Production 同樣被這個白名單擋在外面：那上面的寫入會進 Neon 的 main 分支。
  it('只跑 Vercel 的 Preview 部署（白名單，不是排除 Production）', () => {
    const condition = jobCondition()

    expect(condition).toMatch(/deployment\.environment\s*==\s*'Preview'/)
    expect(condition, '黑名單擋不住 Vercel 以外的 deployment 事件').not.toMatch(/deployment\.environment\s*!=/)
  })

  // 白名單之外的第二道：environment_url 是這支 workflow 唯一的輸入，空的就沒有東西可測。
  // 少了它，任何「environment 剛好叫 Preview 但沒有 URL」的來源都會讓 job 白跑一輪。
  it('沒有 environment_url 就不跑', () => {
    expect(jobCondition()).toMatch(/deployment_status\.environment_url\s*!=\s*''/)
  })
})

describe('打的是 preview，跑的是完整的 E2E', () => {
  // 這一條是整支 workflow 的核心接線：environment_url 是 deployment_status 事件
  // 唯一「已經就緒」的 URL。接錯或漏接的話，config 會 fallback 去起本機 dev server，
  // 而這個 runner 沒有資料庫也沒有 .env——結果是白等到逾時。
  it('PLAYWRIGHT_BASE_URL 接的是 deployment_status 的 environment_url', () => {
    const step = stepRunning('test:e2e')

    expect(step, '找不到執行 pnpm test:e2e 的步驟').toBeDefined()
    expect(step).toMatch(/PLAYWRIGHT_BASE_URL:\s*\$\{\{\s*github\.event\.deployment_status\.environment_url\s*\}\}/)
  })

  // checkout 不指定 ref 就得仰賴事件的預設值。spec 的版本與 preview 上跑的版本
  // 一旦不同，失敗會以「改了測試卻沒生效」的形式出現，是最難查的一種。
  it('checkout 的是被部署的那個 commit', () => {
    const step = steps().find(candidate => candidate.includes('actions/checkout'))

    expect(step, '找不到 checkout 步驟').toBeDefined()
    expect(step).toMatch(/ref:\s*\$\{\{\s*github\.event\.deployment\.sha\s*\}\}/)
  })

  // 跑的是整包，不是挑幾支。`--workers` 這類執行參數可以調，
  // 但一旦出現指定檔案的參數，「E2E 綠了」就不再等於「E2E 全綠」。
  it('跑的是完整的 pnpm test:e2e，沒有只挑某幾支 spec', () => {
    expect(runOf(stepRunning('test:e2e')!)).not.toMatch(/tests\/e2e\/\S+\.spec\.ts/)
  })
})

// ── 「會不會變成永遠綠燈」的防線（比照 ci-checks.test.ts）──
describe('沒有讓 E2E 失敗被吞掉的開關', () => {
  // continue-on-error 會讓步驟失敗卻不影響 job 結論，是最容易被順手加上的作弊開關。
  it('沒有任何步驟掛 continue-on-error', () => {
    expect(code(raw())).not.toContain('continue-on-error')
  })

  // `|| true` / `|| echo` 讓指令失敗仍然回 0。
  it('E2E 的指令沒有被 || 吞掉結果', () => {
    expect(runOf(stepRunning('test:e2e')!)).not.toMatch(/\|\|/)
  })

  // 產出物的上傳可以 !cancelled()，執行測試那一步不行——
  // 掛上去等於「不管前面怎樣都當作跑過了」。
  it('E2E 那一步沒有掛 always() / !cancelled()', () => {
    const step = stepRunning('test:e2e')!

    expect(step).not.toMatch(/if:\s*\$\{\{\s*always\(\)\s*\}\}/)
    expect(step).not.toMatch(/if:\s*\$\{\{\s*!\s*cancelled\(\)\s*\}\}/)
  })
})

describe('權限與隔離', () => {
  // 這支會 checkout 並執行 PR 上的程式碼（public repo，fork 也進得來）。
  // 給了寫入權限，它就從「跑測試」變成一條寫入管道。
  it('權限只有 contents: read', () => {
    const permissions = topLevel('permissions')

    expect(permissions).toMatch(/contents:\s*read/)
    expect(permissions).not.toMatch(/write/)
  })

  // concurrency 的 key 若只用 deployment.environment，而 Vercel 給所有 preview
  // 同一個字串，cancel-in-progress 就會跨 PR 互相取消——B 的 E2E 被 A 的推送殺掉，
  // 而且顯示成 cancelled 而不是失敗。
  it('concurrency 的 key 不是只有 environment', () => {
    const concurrency = topLevel('concurrency')

    expect(concurrency).toMatch(/group:/)
    expect(concurrency).not.toMatch(/group:\s*\S*\$\{\{\s*github\.event\.deployment\.environment\s*\}\}\s*$/m)
  })
})
