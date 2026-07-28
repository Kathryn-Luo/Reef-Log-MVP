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
    const matched = /^ {2}([\w-]+):\s*(?:#.*)?$/.exec(line)
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

/**
 * 去掉 YAML 的區塊指示符（`>` / `|`）與所有空白，
 * 讓折行與縮排的差異不影響運算式比對。
 */
const squash = (expression: string) =>
  expression.replace(/^\s*[>|][-+]?/, '').replace(/\s+/g, '')

describe.each(cases)('$file 的核准被拒回報', ({ file, gatedJob, trigger }) => {
  const jobs = readJobs(file)
  const gated = jobs.find(job => job.name === gatedJob)!
  const authorize = jobs.find(job => job.name === 'authorize')!
  const report = jobs.find(job => job.name !== gatedJob && jobKey(job, 'needs')?.includes(gatedJob))

  // 解析器壞掉時，下面一票 not.toContain 會集體真空通過。先釘住結構。
  it('workflow 解析出預期的三個 job', () => {
    expect(jobs.map(job => job.name)).toEqual(['authorize', gatedJob, 'report'])
  })

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

  // 真正決定「核准被拒時還會不會留言」的是【步驟層】的 if，不是 job 層。
  // 只檢查 job 層的話，把步驟改成 if: success() 會讓 #26 的 bug 原封不動長回來，
  // 測試卻全綠。
  it('回報 job 的每一個步驟都掛 always()', () => {
    const steps = code(report!).split(/^ {6}- (?=name:|uses:|run:|id:)/m).slice(1)
    expect(steps.length).toBeGreaterThan(0)
    for (const step of steps) expect(step).toMatch(/if:\s*always\(\)/)
  })

  // needs 少了 authorize，needs.authorize.outputs.approved 就永遠解析不出值，
  // 兩個步驟會被永遠跳過 → 全流程靜默。
  it('回報 job 同時 needs authorize 與被保護的 job', () => {
    expect(jobKey(report!, 'needs')).toContain('authorize')
    expect(jobKey(report!, 'needs')).toContain(gatedJob)
  })

  // Then 被貼上 needs-human
  it('回報 job 負責貼上 needs-human', () => {
    expect(runScripts(report!)).toContain('--add-label needs-human')
  })

  // Then 只有一則回報留言，不重複：被保護的 job 內不再自己留言 / 貼 label。
  it(`${gatedJob} 內不再有任何回報步驟`, () => {
    const gatedRun = runScripts(gated)
    // 正向錨點：runScripts 若因縮排慣例改變而解析成空字串，下面三條 not.toContain
    // 會集體真空通過。先確認它真的抓到了這個 job 的 shell。
    // （原本錨在 `curl -sSLf` 上；#27 把截圖下載抽成共用 script 之後，
    //   這個 job 的 shell 裡改成呼叫那支 script，錨點跟著換。）
    expect(gatedRun).toContain('fetch-issue-images.sh')
    expect(gatedRun).not.toContain('gh issue comment')
    expect(gatedRun).not.toContain('gh pr comment')
    expect(gatedRun).not.toContain('needs-human')

    // 被保護的 job 內不該再有「無論如何都要跑的收尾」——核准被拒時它一步都不會
    // 執行，留在這裡只是假象。只禁「always()/failure() 步驟裡做回報」而不是禁掉
    // 所有 always()，否則日後想加個 always() 的 artifact 上傳就會誤紅。
    const gatedSteps = code(gated).split(/^ {6}- (?=name:|uses:|run:|id:)/m).slice(1)
    for (const step of gatedSteps) {
      if (!/if:\s*(always|failure)\(\)/.test(step)) continue
      expect(step).not.toContain('gh issue comment')
      expect(step).not.toContain('gh pr comment')
      expect(step).not.toContain('--add-label')
    }
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
    const reportRun = runScripts(report!)
    expect(reportRun).toMatch(/核准/)
    expect(reportRun).toMatch(/執行紀錄/)
    expect(code(report!)).toContain('RUN_URL')

    // 不可以拿 skipped 當作「核准被拒」的判斷依據：切出 skipped 這個 case
    // 區塊，斷言它沒有把「核准」寫進去。舊寫法要求兩者同一行，實務上判斷式與
    // 訊息必然分行，等於恆真。
    const skippedCase = /^\s*skipped\)$([\s\S]*?)^\s*;;$/m.exec(reportRun)
    expect(skippedCase, '找不到 skipped 的 case 區塊').not.toBeNull()
    expect(skippedCase![1]).not.toMatch(/核准/)
  })

  // #25 踩過的坑 2：沒有 checkout 就必須自己給 GH_REPO，gh 不讀 $GITHUB_REPOSITORY。
  it('回報 job 沒有 checkout 時必須傳 GH_REPO', () => {
    expect(code(report!)).not.toContain('actions/checkout')
    expect(code(report!)).toContain('GH_REPO: ${{ github.repository }}')
  })

  // #25 踩過的坑 3：不要用 || true 吞掉權限 / API 錯誤。
  it('回報 job 不用 || true 吞錯誤', () => {
    expect(runScripts(report!)).not.toContain('|| true')
  })

  // 沒寫 shell: 時 GitHub Actions 用的是 `bash -e {0}`——沒有 pipefail。
  // 管線的 exit status 因此取決於最後一段：`gh ... | jq ...` 在 gh 掛掉時
  // jq 讀空輸入照樣 exit 0，查詢失敗會被誤判成「查到了，但結果是空的」。
  it('回報 job 內若用管線查資料，必須自己開 pipefail', () => {
    const script = runScripts(report!)
    // 管線常寫成多行（行尾 `\` 續行），所以不能只看單行。
    if (!/\|\s*jq\b/.test(script.replace(/\\\n/g, ' '))) return
    expect(script, '有 gh | jq 管線卻沒有 set -o pipefail').toContain('set -o pipefail')
  })

  // #25 踩過的坑 4：job 層的 if 不依賴「失敗 job 的 output」，改看 event payload。
  it('回報 job 的 job 層 if 只看 event payload', () => {
    const condition = jobKey(report!, 'if')!
    expect(condition).not.toMatch(/needs\.[\w-]+\.outputs/)
    expect(condition).toContain(trigger)
  })

  // 最容易 drift 的地方：日後在 authorize 的 if 加了條件卻忘了同步 report，
  // report 就會在 authorize 被 skip 的情況下照樣啟動。逐字比對守住它。
  it('回報 job 的 if 與 authorize 的條件逐字等價', () => {
    expect(squash(jobKey(report!, 'if')!))
      .toBe(`always()&&(${squash(jobKey(authorize, 'if')!)})`)
  })

  // #26 的合約是「沒有靜默的路徑」。report 的步驟都被 approved 守住，
  // 所以 authorize 沒走到 gate 的路徑必須由 authorize 自己兜底。
  it('authorize 有 always() 的兜底回報，且不依賴跨 job 傳值', () => {
    const fallback = code(authorize)
      .split(/^ {6}- (?=name:|uses:|run:|id:)/m)
      .find(step => step.includes('授權階段未留言時補上回報'))
    expect(fallback, 'authorize 缺少兜底回報步驟').toBeDefined()
    expect(fallback!).toMatch(/if:\s*>?\s*always\(\)/)
    expect(fallback!).toMatch(/steps\.gate\.outputs\.approved != 'true'/)
    expect(fallback!).not.toMatch(/needs\./)
    expect(fallback!).toContain('--add-label needs-human')
  })
})

// #25 踩過的坑 5：schema-design 有兩種觸發，回報目標不同（Epic vs. 草稿 PR）。
describe('schema-design.yml 的雙觸發分流', () => {
  const jobs = readJobs('schema-design.yml')
  const report = jobs.find(job => job.name !== 'design' && jobKey(job, 'needs')?.includes('design'))!

  it('回報 job 沿用 issues / pull_request_review 的分流', () => {
    const reportCode = runScripts(report)
    expect(reportCode).toContain('gh issue comment')
    expect(reportCode).toContain('gh pr comment')
    expect(reportCode).toContain('gh pr edit')
    expect(jobKey(report, 'if')).toContain('pull_request_review')
  })
})
