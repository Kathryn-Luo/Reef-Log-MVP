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

const raw = () => readFileSync(workflowPath, 'utf8')

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

/** 找出「執行某個 pnpm script」的步驟。 */
const stepRunning = (script: string) =>
  steps().find(step => new RegExp(`(^|\\s)pnpm ${script}(\\s|$)`, 'm').test(runOf(step)))

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

  // Then 三項檢查各自有一個步驟，且沒有被合併成一行——
  // 合併的話 lint 一失敗就看不到測試結果，等於少了兩個訊號。
  it.each(['lint', 'typecheck', 'test'])('有獨立的 pnpm %s 步驟', (script) => {
    expect(stepRunning(script), `找不到執行 pnpm ${script} 的步驟`).toBeDefined()
  })

  // 前一項失敗不該讓後兩項被跳過：三個訊號要一次看齊，否則修一輪只知道一件事。
  // 用 !cancelled() 而不是 always()：run 被取消時就不必再跑。
  it.each(['lint', 'typecheck', 'test'])('pnpm %s 不因前一步失敗而被跳過', (script) => {
    expect(stepRunning(script)).toMatch(/if:\s*\$\{\{\s*!\s*cancelled\(\)\s*\}\}/)
  })

  // ── 以下是「CI 會不會變成永遠綠燈」的防線 ──

  // continue-on-error 會讓步驟失敗卻不影響 job 結論，是最容易被順手加上的作弊開關。
  it('沒有任何步驟掛 continue-on-error', () => {
    expect(code(raw())).not.toContain('continue-on-error')
  })

  // `|| true` / `|| echo` 同理：指令失敗被吞掉，step 仍然回 0。
  it('檢查步驟不吞掉非零結束碼', () => {
    for (const script of ['lint', 'typecheck', 'test']) {
      expect(runOf(stepRunning(script)!)).not.toMatch(/\|\|/)
    }
  })

  // vitest 預設在「一個測試都沒收到」時失敗。加上 --passWithNoTests 會讓
  // 「測試檔被整批刪掉」這種最粗暴的作弊手法變成綠燈。
  it('pnpm test 不加 --passWithNoTests，也不縮限成單一檔案', () => {
    const run = runOf(stepRunning('test')!)
    expect(run).not.toContain('passWithNoTests')
    expect(run.trim()).toBe('pnpm test')
  })

  // ── 以下是權限面 ──

  // 這支不呼叫 agent，不需要寫入權限，也不需要任何 secret。
  // 一旦要了 write，PR 上的檢查就成了 fork PR 可觸及的寫入管道。
  it('權限只有 contents: read', () => {
    expect(topLevel('permissions')?.trim()).toBe('contents: read')
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

  // E2E 需要 preview URL 與瀏覽器，屬於 #23 的範圍。混進來會讓這支必紅。
  it('不執行 E2E', () => {
    const text = code(raw())
    expect(text).not.toContain('pnpm test:e2e')
    expect(text).not.toContain('playwright install')
  })
})
