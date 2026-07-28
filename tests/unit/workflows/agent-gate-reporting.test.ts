import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// issue #26：schema-design / epic-breakdown 在 environment 核准被拒（或逾時）時完全靜默。
//
// 這條路徑沒辦法用「跑一次 workflow」來驗證——核准被拒是 GitHub 端的行為，
// 而它造成的後果正好是「被保護的 job 一步都不會執行」。因此這裡驗證的是
// workflow 定義本身的結構性不變量：回報的責任必須落在 environment 閘門「外面」
// 的 job 上。這是驗收條件唯一機械可查的形式。

// vitest 的 cwd 是專案根目錄；nuxt 測試環境下 import.meta.url 不指向真實檔案位置。
const workflowPath = (name: string) =>
  resolve(process.cwd(), '.github/workflows', name)

interface Job {
  name: string
  body: string
}

/** 取出 `jobs:` 底下每一個 job（縮排 2 的 key）與它的整段內容。 */
function readJobs(file: string): Job[] {
  const lines = readFileSync(workflowPath(file), 'utf8').split('\n')
  const start = lines.indexOf('jobs:')
  expect(start, `${file} 找不到 jobs:`).toBeGreaterThanOrEqual(0)

  const jobs: Job[] = []
  let current: Job | undefined
  for (const line of lines.slice(start + 1)) {
    const matched = /^ {2}([\w-]+):\s*$/.exec(line)
    if (matched) {
      current = { name: matched[1]!, body: '' }
      jobs.push(current)
      continue
    }
    if (current) current.body += `${line}\n`
  }
  return jobs
}

/**
 * 剝掉整行的註解。這些 workflow 的註解裡會引述指令本身（例如「沒有 `gh issue
 * comment`」「不用 `|| true`」），純文字比對會誤中散文而不是真的行為。
 */
function code(job: Job): string {
  return job.body
    .split('\n')
    .filter(line => !/^\s*#/.test(line))
    .join('\n')
}

/**
 * 只取出 workflow 自己執行的 shell（步驟的 `run:`，縮排 8）。
 * 不能拿整個 job 比對：`with.claude_args` 的 allowedTools 與 prompt 裡也會出現
 * `gh pr comment`，那是「授權 agent 去回覆 review」的能力，不是 workflow 的回報步驟。
 */
function runScripts(job: Job): string {
  const lines = code(job).split('\n')
  const collected: string[] = []
  let inRun = false
  for (const line of lines) {
    if (/^ {8}run:/.test(line)) {
      inRun = true
      collected.push(line.slice('        run:'.length))
      continue
    }
    if (inRun) {
      if (line.trim() !== '' && !/^ {10}/.test(line)) inRun = false
      else collected.push(line)
    }
  }
  return collected.join('\n')
}

/** 取出 job 內某個「job 層」的 key（縮排 4），含其後續的多行區塊。 */
function jobKey(job: Job, key: string): string | undefined {
  const lines = job.body.split('\n')
  const index = lines.findIndex(line => line.startsWith(`    ${key}:`))
  if (index === -1) return undefined

  const collected = [lines[index]!.slice(`    ${key}:`.length)]
  for (const line of lines.slice(index + 1)) {
    if (/^ {4}\S/.test(line)) break
    collected.push(line)
  }
  return collected.join('\n')
}

const cases = [
  { file: 'schema-design.yml', gatedJob: 'design', trigger: 'schema:design' },
  { file: 'epic-breakdown.yml', gatedJob: 'breakdown', trigger: 'epic:breakdown' },
] as const

describe.each(cases)('$file 的核准被拒回報', ({ file, gatedJob, trigger }) => {
  const jobs = readJobs(file)
  const gated = jobs.find(job => job.name === gatedJob)!
  const report = jobs.find(job => job.name !== gatedJob && jobKey(job, 'needs')?.includes(gatedJob))

  it(`${gatedJob} 仍然掛著 environment 閘門`, () => {
    expect(jobKey(gated, 'environment')?.trim()).toBe('agent')
  })

  // Given 停在 agent environment 等待核准 / When 核准被拒或逾時
  // Then 回報留言仍然出現——即回報邏輯不依賴被保護的 job 內部跑過任何 step。
  it('回報 job 存在，站在 environment 閘門外，並以 always() 觀察被保護的 job', () => {
    expect(report, `${file} 找不到回報 job`).toBeDefined()
    expect(jobKey(report!, 'environment')).toBeUndefined()
    expect(jobKey(report!, 'if')).toContain('always()')
  })

  // Then 被貼上 needs-human
  it('回報 job 負責貼上 needs-human', () => {
    expect(code(report!)).toContain('--add-label needs-human')
  })

  // Then 只有一則回報留言，不重複：被保護的 job 內不再自己留言 / 貼 label。
  it(`${gatedJob} 內不再有任何回報步驟`, () => {
    const gatedRun = runScripts(gated)
    expect(gatedRun).not.toContain('gh issue comment')
    expect(gatedRun).not.toContain('gh pr comment')
    expect(gatedRun).not.toContain('needs-human')
    // 被保護的 job 內不該再有任何「無論如何都要跑」的收尾步驟——
    // 核准被拒時它們一步都不會執行，留在這裡只是假象。
    expect(code(gated)).not.toContain('if: always()')
    expect(code(gated)).not.toContain('if: failure()')
  })

  // 回報 job 內也只能有一個留言步驟——兩種觸發的分流要在同一步內用 if 決定，
  // 否則 issues 觸發時會同時送出兩則。
  // （authorize 的閘門仍可自己留言：閘門擋下時 report 不會回報，兩邊互斥。）
  it('回報 job 內只有一個留言步驟', () => {
    const commentSteps = code(report!)
      .split(/^ {6}- (?=name:|uses:|run:|id:)/m)
      .filter(step => step.includes('gh issue comment') || step.includes('gh pr comment'))
    expect(commentSteps).toHaveLength(1)
  })

  // #25 踩過的坑 1：核准被拒與執行失敗的 result 都是 failure，無法區分。
  it('failure 時不猜單一原因，兩種可能都列出並附執行紀錄', () => {
    const reportCode = code(report!)
    expect(reportCode).toMatch(/核准/)
    expect(reportCode).toMatch(/執行紀錄/)
    expect(reportCode).toContain('RUN_URL')
    // 不可以拿 skipped 當作「核准被拒」的判斷依據
    expect(reportCode).not.toMatch(/result[^\n]*skipped[^\n]*核准/)
  })

  // #25 踩過的坑 2：沒有 checkout 就必須自己給 GH_REPO，gh 不讀 $GITHUB_REPOSITORY。
  it('回報 job 沒有 checkout 時必須傳 GH_REPO', () => {
    expect(code(report!)).not.toContain('actions/checkout')
    expect(code(report!)).toContain('GH_REPO: ${{ github.repository }}')
  })

  // #25 踩過的坑 3：不要用 || true 吞掉權限 / API 錯誤。
  it('回報 job 不用 || true 吞錯誤', () => {
    expect(code(report!)).not.toContain('|| true')
  })

  // #25 踩過的坑 4：job 層的 if 不依賴「失敗 job 的 output」，改看 event payload。
  it('回報 job 的 job 層 if 只看 event payload', () => {
    const condition = jobKey(report!, 'if')!
    expect(condition).not.toMatch(/needs\.[\w-]+\.outputs/)
    expect(condition).toContain(trigger)
  })
})

// #25 踩過的坑 5：schema-design 有兩種觸發，回報目標不同（Epic vs. 草稿 PR）。
describe('schema-design.yml 的雙觸發分流', () => {
  const jobs = readJobs('schema-design.yml')
  const report = jobs.find(job => job.name !== 'design' && jobKey(job, 'needs')?.includes('design'))!

  it('回報 job 沿用 issues / pull_request_review 的分流', () => {
    const reportCode = code(report)
    expect(reportCode).toContain('gh issue comment')
    expect(reportCode).toContain('gh pr comment')
    expect(reportCode).toContain('gh pr edit')
    expect(jobKey(report, 'if')).toContain('pull_request_review')
  })
})
