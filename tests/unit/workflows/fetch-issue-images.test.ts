import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

// issue #27：三支 workflow 的截圖下載步驟有兩個缺陷。
//
// A（主要）：`gh issue view` 在 pipeline 的開頭，pipeline 的結束狀態取自最後一個
//   元素（while 迴圈），gh 失敗時迴圈讀不到任何一行、正常結束並回傳 0。
//   step 因此「存活但產出 0 張截圖」，agent 接著只憑文字描述做設計。
// B（次要）：curl 沒有重試，CDN 抖動一次就讓整個 job 失敗——而這一步在
//   schema-design 與 develop 裡都在 environment 的人工核准「之後」才執行。
//
// 邏輯抽成 .github/scripts/fetch-issue-images.sh 由三支共用。它是真的 shell script，
// 所以這裡不做結構性斷言，而是「真的執行它」：把假的 gh 與 curl 放到 PATH 前面，
// 模擬各種失敗情境，直接驗它的結束狀態與產出。

const script = resolve(process.cwd(), '.github/scripts/fetch-issue-images.sh')

const ASSET = 'https://github.com/user-attachments/assets'
const url = (n: number) => `${ASSET}/00000000-0000-0000-0000-00000000000${n}`

interface RunResult {
  status: number
  stdout: string
  stderr: string
  images: string[]
  body: string
  curlLog: string[]
}

let workspace: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'fetch-images-'))
})

/**
 * 假的 gh：GH_BODY 指到的檔案就是 issue 內文；GH_FAIL 設了就模擬 API 失敗。
 * 假的 curl：只認得 `-o <路徑>` 與 URL，其餘旗標略過，但會把完整 argv 記進 CURL_LOG，
 * 讓測試看得到我們到底有沒有要求重試。
 */
function installStubs(bin: string) {
  mkdirSync(bin, { recursive: true })

  // 這兩支 stub 用陣列拼接而不是樣板字串：內容全是 shell 的 $ 變數，
  // 寫在樣板字串裡要逐個跳脫，可讀性與正確性都會變差。
  writeFileSync(join(bin, 'gh'), [
    '#!/usr/bin/env bash',
    'if [ -n "${GH_FAIL:-}" ]; then',
    '  echo "gh: API error" >&2',
    '  exit 1',
    'fi',
    'cat "$GH_BODY"',
  ].join('\n'))

  // CURL_TRANSIENT：模擬「第一次失敗」的暫時性錯誤。真實 curl 收到 --retry 會自己
  // 重試，所以這裡的判斷是：有要求重試就當作重試後成功，沒要求就直接失敗。
  // 這正是要驗的合約——重試旗標不是裝飾。
  writeFileSync(join(bin, 'curl'), [
    '#!/usr/bin/env bash',
    'printf \'%s\\n\' "$*" >> "$CURL_LOG"',
    'out=""',
    'url=""',
    'retry=0',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    '    -o) out="$2"; shift 2 ;;',
    '    --retry) retry=1; shift 2 ;;',
    '    --retry-delay) shift 2 ;;',
    '    --retry-all-errors) retry=1; shift ;;',
    '    -*) shift ;;',
    '    *) url="$1"; shift ;;',
    '  esac',
    'done',
    'if [ -n "${CURL_FAIL_ALL:-}" ]; then exit 22; fi',
    'if [ -n "${CURL_TRANSIENT:-}" ] && [ "$url" = "${CURL_TRANSIENT}" ] && [ "$retry" != "1" ]; then',
    '  exit 22',
    'fi',
    'if [ -n "${CURL_NOWRITE:-}" ]; then exit 0; fi',
    'printf \'PNG\' > "$out"',
  ].join('\n'))

  for (const name of ['gh', 'curl']) chmodSync(join(bin, name), 0o755)
}

function run(body: string, env: Record<string, string> = {}): RunResult {
  const bin = join(workspace, 'bin')
  installStubs(bin)

  const bodyFixture = join(workspace, 'issue-body.txt')
  writeFileSync(bodyFixture, body)

  const bodyFile = join(workspace, '.agent-issue.md')
  const imageDir = join(workspace, '.agent-images')
  const curlLog = join(workspace, 'curl.log')
  writeFileSync(curlLog, '')

  const result = spawnSync('bash', [script, '7', bodyFile, imageDir], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GH_BODY: bodyFixture,
      CURL_LOG: curlLog,
      ...env,
    },
  })

  // 目錄／檔案不存在也是一種要驗的結果（gh 失敗那條路徑），所以不讓它 throw。
  const listOrEmpty = () => {
    try {
      return readdirSync(imageDir).sort()
    }
    catch {
      return []
    }
  }
  const readOrEmpty = () => {
    try {
      return readFileSync(bodyFile, 'utf8')
    }
    catch {
      return ''
    }
  }

  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    images: listOrEmpty(),
    body: readOrEmpty(),
    curlLog: readFileSync(curlLog, 'utf8').split('\n').filter(Boolean),
  }
}

const bodyWith = (count: number) =>
  `# Epic\n\n${Array.from({ length: count }, (_, i) => `<img src="${url(i + 1)}">`).join('\n')}\n`

describe('fetch-issue-images.sh', () => {
  // Given Epic 內文含有 N 張（N > 0）截圖附件
  // When  截圖下載步驟執行且 gh 與 curl 都正常
  // Then  .agent-images/ 內恰好有 N 個檔案，step 成功
  it('N 張截圖全部下載成功', () => {
    const result = run(bodyWith(3))
    expect(result.status, result.stderr).toBe(0)
    expect(result.images).toEqual(['screen-1.png', 'screen-2.png', 'screen-3.png'])
    expect(result.body).toContain('# Epic')
  })

  // Given gh issue view 因 API 或權限問題失敗
  // When  截圖下載步驟執行
  // Then  step 必須失敗並留下清楚訊息，不可以「存活但產出 0 張截圖」
  //
  // 這是 #27 的核心。舊寫法在這個情境下 exit 0、產出 0 張圖，
  // agent 接著就只憑文字描述做設計。
  it('gh 失敗時必須失敗，不可以存活但 0 張截圖', () => {
    const result = run(bodyWith(3), { GH_FAIL: '1' })
    expect(result.status, 'gh 失敗卻讓 step 存活了').not.toBe(0)
    expect(result.images).toEqual([])
  })

  // Given Epic 內文含有 N 張截圖，其中某一張的 curl 遭遇暫時性錯誤
  // When  截圖下載步驟執行
  // Then  該張會被重試
  //
  // 假 curl 的行為：沒有收到重試旗標就直接失敗。所以這條紅了就代表我們沒要求重試。
  it('暫時性錯誤會重試（重試旗標必須真的傳給 curl）', () => {
    const result = run(bodyWith(3), { CURL_TRANSIENT: url(2) })
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.images).toHaveLength(3)
    for (const call of result.curlLog) {
      expect(call).toContain('--retry')
      expect(call).toContain('--retry-all-errors')
    }
  })

  // Then  重試後仍失敗才讓 step 失敗，且訊息指出是哪一張
  it('重試後仍失敗時 step 失敗，且訊息指出是哪一張', () => {
    const result = run(bodyWith(3), { CURL_FAIL_ALL: '1' })
    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).toContain(url(1))
  })

  // Given Epic 內文完全沒有截圖附件（例如純邏輯 issue）
  // When  截圖下載步驟執行
  // Then  step 成功且 .agent-images/ 為空——這是允許的情況，
  //       不可與「gh 失敗」混為一談
  it('沒有截圖是合法情況，成功且目錄為空', () => {
    const result = run('# 純邏輯 issue\n\n沒有任何附件。\n')
    expect(result.status, result.stderr).toBe(0)
    expect(result.images).toEqual([])
    expect(result.curlLog).toEqual([])
  })

  // 同一張圖在內文裡出現兩次（例如同時寫在說明與附圖區）不該算成兩張。
  it('重複的 URL 會去重', () => {
    const result = run(`${bodyWith(2)}\n再貼一次：<img src="${url(1)}">\n`)
    expect(result.status, result.stderr).toBe(0)
    expect(result.images).toEqual(['screen-1.png', 'screen-2.png'])
  })

  // 防守用：curl 回 0 卻沒真的產出檔案時，數量斷言要接住。
  // 少了這道，agent 會拿著半套素材硬做。
  it('數量對不上時失敗', () => {
    const result = run(bodyWith(3), { CURL_NOWRITE: '1' })
    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).toMatch(/3/)
  })

  // 內文裡的 URL 數量是唯一的真相來源，訊息要講得出來。
  it('回報內文裡有幾張截圖', () => {
    const result = run(bodyWith(2))
    expect(result.stdout).toMatch(/2/)
  })
})

// ── 三支 workflow 都必須改用這支共用 script ──
// 「修一支忘兩支」正是 #27 長出來的原因（tdd-develop 早就修好了，
// 另外兩支沒跟上），所以這裡把「三支都用同一段邏輯」變成機械可查的。
describe('三支 workflow 都改用共用 script', () => {
  const workflows = ['schema-design.yml', 'epic-breakdown.yml', 'tdd-develop.yml']

  const read = (name: string) =>
    readFileSync(resolve(process.cwd(), '.github/workflows', name), 'utf8')

  it.each(workflows)('%s 呼叫 fetch-issue-images.sh', (name) => {
    expect(read(name)).toContain('.github/scripts/fetch-issue-images.sh')
  })

  // 舊的脆弱 pipeline 必須整段消失，不能只是多加一支 script 卻沒人用。
  it.each(workflows)('%s 不再自己組 gh | grep | curl 的 pipeline', (name) => {
    const text = read(name)
    expect(text).not.toContain('user-attachments/assets')
    expect(text).not.toMatch(/curl -sSLf -o/)
  })

  it('script 有可執行權限', () => {
    const mode = execFileSync('stat', ['-c', '%a', script], { encoding: 'utf8' }).trim()
    expect(mode, `.github/scripts/fetch-issue-images.sh 權限是 ${mode}`).toMatch(/[157]{1}[157]{1}[157]{1}/)
  })
})
