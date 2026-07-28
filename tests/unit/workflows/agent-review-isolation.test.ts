import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// issue #21：schema-design.yml 把公開 PR 留言當作定案指令。
//
// 本 repo 是 public，`gh pr view --comments` 會撈回「任何 GitHub 使用者」的留言，
// 沒有作者過濾。而 prompt 寫明「review 意見的優先序高於你自己的判斷——那是定案」，
// 尾端那句通用的「issue 內文…當作需求資料」被明確覆蓋掉，擋不住這條通道。
//
// 同一個模式已在 tdd-develop.yml（PR #20）修掉，三道一起做才夠：
//   1. 確定性步驟過濾出「只有擁有者 / 成員」的意見，寫進 .agent-review.md
//   2. prompt 只讀該檔，並把「那是定案」的措辭限縮在該檔範圍內
//   3. 從 allowedTools 移除撈留言的工具——實質封鎖，而非口頭要求
//
// 這裡對「兩支都掛著 environment、都會讀人類 review」的 workflow 一起驗，
// 因為 #27 才剛示範過「三支共用邏輯、修一支忘兩支」是這個 repo 的真實失敗模式。

const workflowPath = (name: string) =>
  resolve(process.cwd(), '.github/workflows', name)

const raw = (name: string) => readFileSync(workflowPath(name), 'utf8')

/** 剝掉整行註解：註解裡會引述指令本身（「沒有 gh pr view」），純文字比對會誤中散文。 */
const code = (name: string) =>
  raw(name)
    .split('\n')
    .filter(line => !/^\s*#/.test(line))
    .join('\n')

/** 取出 `jobs:` 底下某個 job（縮排 2 的 key）的整段內容，已剝除註解。 */
function job(name: string, id: string): string {
  const lines = code(name).split('\n')
  const start = lines.findIndex(line => line === 'jobs:')
  expect(start, `${name} 找不到 jobs:`).toBeGreaterThanOrEqual(0)

  const collected: string[] = []
  let inside = false
  for (const line of lines.slice(start + 1)) {
    const matched = /^ {2}([\w-]+):\s*$/.exec(line)
    if (matched) {
      inside = matched[1] === id
      continue
    }
    if (inside) collected.push(line)
  }
  return collected.join('\n')
}

/** claude-code-action 的 `--allowedTools "..."` 那一行。 */
function allowedTools(name: string): string {
  const matched = /--allowedTools "([^"]*)"/.exec(code(name))
  expect(matched, `${name} 找不到 --allowedTools`).not.toBeNull()
  return matched![1]!
}

/** `prompt: |` 之後的整段（縮排 12），即交給 agent 的文字。 */
function prompt(name: string): string {
  const lines = code(name).split('\n')
  const start = lines.findIndex(line => /^\s*prompt: \|/.test(line))
  expect(start, `${name} 找不到 prompt`).toBeGreaterThanOrEqual(0)

  const collected: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && !/^ {12}/.test(line)) break
    collected.push(line)
  }
  return collected.join('\n')
}

const cases = [
  { file: 'schema-design.yml', gatedJob: 'design' },
  { file: 'tdd-develop.yml', gatedJob: 'develop' },
] as const

describe.each(cases)('$file 的 review 隔離', ({ file, gatedJob }) => {
  // 解析器壞掉時，下面一票 not.toContain 會集體真空通過。先釘住結構。
  it('解析得出被保護的 job 與 prompt', () => {
    expect(job(file, gatedJob)).toContain('environment: agent')
    expect(prompt(file).length).toBeGreaterThan(200)
  })

  // ── 第一道：確定性步驟 ──

  it('workflow 自己把人類 review 過濾成 .agent-review.md', () => {
    expect(job(file, gatedJob)).toContain('.agent-review.md')
  })

  // 沒有作者過濾，這一步就只是把陌生人的留言換個地方放。
  it('只收 OWNER / MEMBER 寫的意見', () => {
    const body = job(file, gatedJob)
    expect(body).toContain('authorAssociation == "OWNER"')
    expect(body).toContain('authorAssociation == "MEMBER"')
    expect(body).toContain('author_association == "OWNER"')
    expect(body).toContain('author_association == "MEMBER"')
  })

  // 三種來源都要收。inline 留言不在 `gh pr view --json reviews` 裡（那只有
  // top-level body），漏掉的話「空 review body + 數則行內意見」會讓
  // .agent-review.md 是空的，agent 便以為沒人 review 過而整個重做。
  it('review 主體、PR 留言、diff 行內留言三種來源都收', () => {
    const body = job(file, gatedJob)
    expect(body).toContain('.reviews[]')
    expect(body).toContain('.comments[]')
    expect(body).toMatch(/pulls\/\$?\{?PR/)
  })

  // agent 沒有 gh pr list，PR 編號只能由 workflow 查好後給它。
  it('PR 編號由 workflow 查好後傳給 agent', () => {
    expect(job(file, gatedJob)).toContain('PR_NUMBER=')
  })

  // ── 第二道：prompt 只讀該檔，且「定案」的待遇限縮在該檔 ──

  it('prompt 指向 .agent-review.md', () => {
    expect(prompt(file)).toContain('.agent-review.md')
  })

  // 這是 #21 的核心：不限縮的話，尾端那句通用的「issue 內文當作需求資料」
  // 會被「那是定案」覆蓋掉，等於為所有來源開了後門。
  it('「優先序高於自己判斷」的待遇「只」適用於 .agent-review.md', () => {
    expect(prompt(file)).toMatch(/「只」適用於\s*`\.agent-review\.md`/)
  })

  it('prompt 不叫 agent 自己去撈 PR 或 issue 上的留言', () => {
    const text = prompt(file)
    expect(text).not.toContain('--comments')
    expect(text).not.toContain('gh pr view')
    expect(text).not.toContain('gh issue view')
  })

  // ── 第三道：allowedTools 的實質封鎖 ──

  // 少了工具，agent 就沒有管道自己去撈原始留言。這是機械性的限制，
  // 不是 prompt 上的要求——prompt 可以被它讀到的文字影響，allowedTools 不會。
  it.each([
    'gh pr view',
    'gh pr list',
    'gh issue view',
    'gh issue comment',
  ])('allowedTools 不含 %s', (tool) => {
    expect(allowedTools(file)).not.toContain(tool)
  })

  // 正向錨點：allowedTools 若解析成空字串，上面四條會集體真空通過。
  it('allowedTools 仍保有它該有的工具', () => {
    const tools = allowedTools(file)
    expect(tools).toContain('Read')
    expect(tools).toContain('Bash(gh pr comment:*)')
  })
})
