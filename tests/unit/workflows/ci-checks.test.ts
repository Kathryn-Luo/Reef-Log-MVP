// @vitest-environment node
// 純文字比對，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// issue #22：PR 上沒有任何獨立於 agent 的自動檢查。
//
// 這支 workflow 的價值在於「它是不是真的、無條件地跑了那三項檢查」，
// 而那件事沒辦法用單元測試實際執行一次 GitHub Actions 來驗證。
// 所以這裡比照 agent-gate-reporting.test.ts 的做法，驗證 workflow 定義本身的
// 結構性不變量——尤其是那些一旦被悄悄放寬，CI 就會變成「永遠綠燈」的地方。

const workflowPath = resolve(process.cwd(), '.github/workflows/ci.yml')
const packagePath = resolve(process.cwd(), 'package.json')

const raw = () => readFileSync(workflowPath, 'utf8')
const packageScripts = () => JSON.parse(readFileSync(packagePath, 'utf8')).scripts as Record<string, unknown>

/** 剝掉整行註解：註解裡會引述指令本身（例如「不要 `|| true`」），純文字比對會誤中散文。 */
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

/** 區塊 run 中逐行執行的命令，不含 YAML 的 `|`。 */
const commandsOf = (step: string) => runOf(step)
  .split('\n')
  .map(line => line.trim())
  .filter(line => line !== '' && line !== '|')

/**
 * 這個步驟有沒有執行某個 pnpm script。
 * `(\s|$)` 的邊界是必要的：少了它，`pnpm test:e2e` 會被誤認成 `pnpm test`。
 */
const runsScript = (step: string, script: string) =>
  new RegExp(`(^|\\s)pnpm ${script}(\\s|$)`, 'm').test(runOf(step))

/** 找出「執行某個 pnpm script」的步驟。 */
const stepRunning = (script: string) => steps().find(step => runsScript(step, script))

/** 依 name 找出步驟。 */
const stepNamed = (name: string) => steps().find(step => step.startsWith(`name: ${name}`))

/** 這支 workflow 必須無條件跑完的檢查。build 見 issue #44。 */
const CHECKS = ['lint', 'typecheck', 'test', 'build'] as const
const SINGLE_COMMAND_CHECKS = ['lint', 'typecheck', 'build'] as const

describe('ci.yml：獨立於 agent 的 PR 檢查', () => {
  it('workflow 檔案存在', () => {
    expect(existsSync(workflowPath), '找不到 .github/workflows/ci.yml').toBe(true)
  })

  // 解析器壞掉時，下面一票斷言會集體真空通過。先釘住結構。
  it('解析得出步驟', () => {
    expect(steps().length).toBeGreaterThan(0)
  })

  // Given 一個開發 PR / When 推上 commit / Then 檢查自動執行
  it('由 pull_request 觸發，並在 main 的 push 上也跑', () => {
    const on = topLevel('on')
    expect(on).toBeDefined()
    expect(on).toMatch(/pull_request:/)
    expect(on).toMatch(/push:/)
    expect(on).toMatch(/main/)
  })

  // Then 四項檢查各自有一個「獨立的」步驟。
  //
  // 只驗「找得到跑 pnpm lint 的步驟」是不夠的：`run: pnpm lint && pnpm typecheck`
  // 會讓同一個步驟同時滿足兩個 script，那正是這條要防的事——合併之後 lint 一紅，
  // typecheck 就永遠不會執行，四個訊號少掉幾個。所以驗的是「落在相異的步驟」。
  it('四項檢查各自是一個獨立步驟', () => {
    const all = steps()
    const indexes = CHECKS.map((script) => {
      const index = all.findIndex(step => runsScript(step, script))
      expect(index, `找不到執行 pnpm ${script} 的步驟`).toBeGreaterThanOrEqual(0)
      return index
    })
    expect(new Set(indexes).size, '檢查被合併進同一個步驟').toBe(CHECKS.length)
  })

  // 前一項失敗不該讓後面的被跳過：所有訊號要一次看齊，否則修一輪只知道一件事。
  // 用 !cancelled() 而不是 always()：run 被取消時就不必再跑。
  it.each(CHECKS)('pnpm %s 不因前一步失敗而被跳過', (script) => {
    expect(stepRunning(script)).toMatch(/if:\s*\$\{\{\s*!\s*cancelled\(\)\s*\}\}/)
  })

  // issue #44：只有打包才會炸的錯誤（例如跨 srcDir 的相對路徑 import，見 #43）
  // 在 lint / typecheck / test 上全綠，要等 Vercel 的 preview deployment 才會紅。
  // CI 的定位是「PR 上唯一獨立於 agent 的綠燈訊號」，那個綠燈必須涵蓋打包。
  it('跑 production build（pnpm build，即 prisma generate && nuxt build）', () => {
    expect(stepRunning('build'), '找不到執行 pnpm build 的步驟').toBeDefined()
  })

  // build 放在最後：前面三項是秒級的快訊號，先讓它們回報完，
  // 再花 30–60 秒打包。順序顛倒的話，一個 lint 錯字也要等完整 build 才看得到。
  it('build 排在 lint / typecheck / test 之後', () => {
    const all = steps()
    const indexOf = (script: string) => all.findIndex(step => runsScript(step, script))
    const buildIndex = indexOf('build')
    for (const script of ['lint', 'typecheck', 'test']) {
      expect(buildIndex, `build 應排在 pnpm ${script} 之後`).toBeGreaterThan(indexOf(script))
    }
  })

  // ── 以下是「CI 會不會變成永遠綠燈」的防線 ──

  // continue-on-error 會讓步驟失敗卻不影響 job 結論，是最容易被順手加上的作弊開關。
  it('沒有任何步驟掛 continue-on-error', () => {
    expect(code(raw())).not.toContain('continue-on-error')
  })

  // 除了 test 需要在同一步驗證 JSON result，其餘每一步只跑那一個指令，逐字比對。
  // 這一條同時擋掉三種手法：
  // - `|| true` / `|| echo`：指令失敗被吞掉，step 仍然回 0
  // - `--passWithNoTests`：vitest 預設在「一個測試都沒收到」時失敗，
  //   加上它會讓「測試檔被整批刪掉」這種最粗暴的作弊變成綠燈
  // - `pnpm test tests/unit/foo.test.ts`：把範圍縮限到剛好會過的那幾個檔
  it.each(SINGLE_COMMAND_CHECKS)('pnpm %s 步驟只跑那一個指令', (script) => {
    expect(runOf(stepRunning(script)!).trim()).toBe(`pnpm ${script}`)
  })

  // issue #35：守門測試若被 vitest.config.ts 排除，就沒有機會保護自己。
  // JSON 必須由同一次 pnpm test 產生，不能用 list 或另一個 invocation 預先探索。
  it('以同一次 unit test 執行結果確認每個測試檔都有實際 test case', () => {
    const unitTests = stepNamed('Unit tests')

    expect(unitTests, '找不到 Unit tests 步驟').toBeDefined()
    expect(unitTests).toMatch(/if:\s*\$\{\{\s*!\s*cancelled\(\)\s*\}\}/)
    expect(unitTests).toContain('VITEST_RESULT_FILE: ${{ runner.temp }}/vitest-result.json')
    expect(commandsOf(unitTests!)).toEqual([
      'pnpm test --reporter=default --reporter=json --outputFile.json="$VITEST_RESULT_FILE"',
      'node .github/scripts/assert-vitest-discovery.mjs "$VITEST_RESULT_FILE"',
    ])
    expect(code(raw())).not.toContain('vitest list')
  })

  // ── 以下是權限面 ──

  // 這支不呼叫 agent，不需要寫入權限，也不需要任何 secret。
  //
  // 不能只驗頂層那一段：job 層的 permissions 會「整個覆蓋」workflow 層，
  // 所以「檔案裡有一段 contents: read」不等於「這支 workflow 只有讀權限」。
  // fork PR 的 GITHUB_TOKEN 會被 GitHub 強制降為唯讀，但同 repo 分支不會——
  // 而同 repo 分支正好是 agent 開 PR 的地方，也就是這支要防的威脅模型本身。
  it('全檔只有一處 permissions，且沒有任何寫入權限', () => {
    const text = code(raw())
    expect(text.match(/^\s*permissions:/gm) ?? []).toHaveLength(1)
    expect(topLevel('permissions')?.trim()).toBe('contents: read')
    expect(text).not.toMatch(/:\s*write\b/)
  })

  it('不使用任何 secret', () => {
    expect(code(raw())).not.toContain('secrets.')
  })

  // environment: agent 帶著 required reviewer。掛上去等於每個 PR 都要人按一次核准，
  // 那就失去「獨立於人與 agent 的綠燈」這個用途了。
  it('不掛 environment 閘門', () => {
    expect(code(raw())).not.toContain('environment:')
  })

  it('不呼叫 claude-code-action', () => {
    expect(code(raw())).not.toContain('claude-code-action')
  })

  // ── 環境前置：與 tdd-develop.yml 對齊，否則 CI 綠了也不代表 agent 那邊跑得起來 ──

  it('用 pnpm，且 Node 版本取自 .nvmrc', () => {
    const text = code(raw())
    expect(text).toContain('pnpm/action-setup@v4')
    expect(text).toContain('node-version-file: .nvmrc')
    expect(text).toContain('cache: pnpm')
    expect(text).not.toMatch(/(^|\s)(npm|yarn) (install|ci)(\s|$)/m)
  })

  // --frozen-lockfile：lockfile 與 package.json 對不上時要失敗，而不是默默改動依賴。
  it('安裝依賴用 --frozen-lockfile', () => {
    expect(code(raw())).toContain('pnpm install --frozen-lockfile')
  })

  // 沒有 prisma generate，@prisma/client 的型別不存在，typecheck 會以無關的理由紅。
  it('跑 prisma generate（不需要 DATABASE_URL）', () => {
    expect(code(raw())).toMatch(/pnpm (prisma generate|prisma:generate)/)
  })

  // issue #62：prisma generate 不會比對 schema 與 migrations；兩者任一邊漏掉，
  // Client 型別照樣產得出來、CI 會假綠。用短命 Postgres 當 shadow DB 做全域 diff，
  // 不讀 Neon URL，也不會碰到 production 或 preview 的資料。
  it('以 Postgres shadow service 執行 migration drift 檢查', () => {
    const text = code(raw())
    const drift = steps().find(step => step.includes('Prisma migration drift'))

    expect(text).toMatch(/services:\s*\n\s+shadow:/)
    expect(text).toMatch(/services:[\s\S]*\n\s+build-db:/)
    expect(text).toContain('image: postgres:16')
    expect(text).toContain('POSTGRES_PASSWORD: postgres')
    expect(drift, '找不到 Prisma migration drift 步驟').toBeDefined()
    expect(runOf(drift!)).toContain('pnpm prisma migrate diff')
    expect(runOf(drift!)).toContain('--from-migrations prisma/migrations')
    expect(runOf(drift!)).toContain('--to-schema-datamodel prisma/schema.prisma')
    expect(runOf(drift!)).toContain('--shadow-database-url')
    expect(runOf(drift!)).toContain('--exit-code')
    expect(runOf(drift!)).toContain('SHADOW_DATABASE_URL')
    expect(drift).toContain('SHADOW_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/postgres')
    expect(drift).not.toContain('schema=')
  })

  // migration 檔進版控卻沒套到 Vercel 的資料庫，是 #62 的另一半。migrate deploy
  // 必須在 generate 與 Nuxt build 之前；seed 是獨立決策，刻意不在這裡執行。
  it('production build 先套用 migration，且不執行 seed', () => {
    expect(packageScripts().build).toBe('prisma migrate deploy && prisma generate && nuxt build')
    expect(packageScripts().build).not.toContain('db:seed')
    expect(stepRunning('build')).toContain('DATABASE_URL: postgresql://postgres:postgres@localhost:5433/postgres')
    expect(stepRunning('build')).toContain('DIRECT_URL: postgresql://postgres:postgres@localhost:5433/postgres')
  })

  // E2E 需要 preview URL 與瀏覽器，屬於 #23 的範圍。混進來會讓這支必紅。
  //
  // issue #176 起 ci.yml 會裝 chromium 給 tests/browser/ 用，所以不能再一律禁止
  // `playwright install`——那條斷言原本是「這裡沒有瀏覽器」的代理指標，而那件事
  // 現在刻意不成立了。要守的東西沒變，改成直接說：**裝瀏覽器可以，跑 E2E 不行。**
  //
  // 為什麼 E2E 仍然不能進來：它要的是一個部署好的 preview URL，那個東西在這支
  // workflow 裡不存在，混進來的結果是這支永遠紅——CI 的定位是「獨立於 agent 的
  // 綠燈訊號」，一個永遠紅的訊號等於沒有訊號。tests/browser/ 沒有這個問題，
  // 它不需要 server、不需要登入。
  it('不執行 E2E', () => {
    const text = code(raw())
    expect(text).not.toContain('pnpm test:e2e')
    expect(text).not.toContain('playwright test')
    expect(text).not.toContain('tests/e2e')
    expect(text).not.toContain('PLAYWRIGHT_BASE_URL')
  })

  // 逐字釘住：能出現的 playwright 指令只有「裝 chromium」這一種。
  // 用白名單而不是黑名單——`playwright install` 後面能接的東西太多，
  // 一項一項禁不完，而該准的就只有這一條。
  it('唯一的 playwright 指令是裝 chromium 給瀏覽器測試用', () => {
    const installs = [...code(raw()).matchAll(/playwright install[^\n]*/g)]
      .map(match => match[0].trim())

    expect(installs).toEqual(['playwright install --with-deps chromium'])
  })
})
