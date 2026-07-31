// @vitest-environment node
// 這支自己也在被守的目錄裡，同樣宣告 node 環境——而且它就是「宣告有效」的執行期證據

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// issue #38：`vitest.config.ts` 設 `environment: 'nuxt'`，於是**每一支** unit 測試檔都會
// 啟動一次 Nuxt 環境。Nuxt 啟動時會透過 unifont 去解析字型 provider（fonts.google.com），
// 外網不可達時那次抓取有機率讓整個測試檔掛掉——形態是「Test Files failed，但沒有任何
// 一條斷言失敗，其餘全部 skipped」。
//
// 而 `tests/unit/workflows/` 底下這幾支測試沒有一支碰到 Vue 元件、Nuxt composable 或
// DOM：它們只讀 workflow / 設定檔做純文字比對，或 spawnSync 跑 shell script。付出啟動
// Nuxt 的代價，換到的是零。
//
// 真正要守的東西是「這個目錄的測試跑在 node 環境」。做法採 issue 的建議 A：每個檔案
// 頂端加一行 docblock，不動 `vitest.config.ts`——做法 B（environmentMatchGlobs / projects）
// 會與 #32 的 `ci-runner-config.test.ts` 白名單斷言正面衝突，那是放寬既有防線。
//
// ── 這支測試證明了什麼、沒證明什麼 ──
//
// 「每個檔案都宣告 node 環境」是靜態掃描，會隨新增檔案自動納入。「宣告真的生效」則
// 由本檔自己的執行環境斷言（沒有 document / window）來證——本檔就在這個目錄下、用的
// 是同一行 pragma，所以它綠就代表那一行確實被 vitest 吃進去了。這個推論成立的前提
// 寫在 NODE_PRAGMA 上：全檔只有第一行帶著那個標記，否則證據會變成套套邏輯。
//
// 沒有自動化的是驗收條件第二條的前置狀態（外網不可達下連跑五次）。真的把外網切斷
// 需要 runner 層級的控制；退一步用 `NODE_OPTIONS --import` 攔 `globalThis.fetch` 也不
// 具鑑別力——實測在本 repo 的 CI runner 上，nuxt 環境下那次字型抓取根本沒發出（已被
// 快取），攔截器記到 0 次呼叫，改不改都一樣綠。與其留一條看起來很威、實際上恆綠的
// 測試，這裡改成守住「離線也不會有差別」的實質前提：這些檔案不碰網路，環境也不碰。
// 連跑五次的實際結果附在 PR 說明裡。

const WORKFLOW_TESTS_DIR = 'tests/unit/workflows'

/**
 * 每個檔案第一行都要逐字是這一行。
 *
 * 刻意用組的，不寫成完整的字面值：vitest 認這個 pragma 的方式是拿
 * `/@(?:vitest|jest)-environment\s+([\w-]+)\b/` 掃**整份檔案內容**，不限於開頭的
 * docblock，也不限於註解裡（vitest 4.1 `detectCodeBlock`）。寫成字面值的話，光是
 * 這一行常數就會把本檔切到 node 環境——下面那條執行期證據會變成套套邏輯：不管
 * 第一行還在不在都是綠的。這不是假設，是這支測試第一次跑紅時真的發生的事。
 *
 * 同一件事也是「第一行逐字」這個要求本身的理由：既然掃的是全文，把 pragma 寫在
 * 檔案中段、甚至寫在散文裡都會生效，讀的人卻看不出這個檔案換了環境。
 */
const NODE_PRAGMA = `// @${'vitest'}-environment node`

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

/**
 * 剝掉整行註解與整段的區塊註解。
 *
 * 非剝不可：這個目錄的測試檔習慣在註解裡引述自己在防的東西（本檔的註解就寫著動態
 * import 與 skip 這兩個標記），拿原始文字比對的話，掃描器會抓到散文而不是程式碼。
 *
 * 只認「整行」的註解，不像 ci-runner-config.test.ts 那樣逐字掃描字串，是因為兩者要防的
 * 方向相反：那支怕的是「誘餌被當成真設定」，漏掉行尾註解就會誤判；這支怕的是「真的
 * 程式碼被漏看」，而程式碼不可能藏在 `//` 後面。行尾註解留著只會讓掃描更嚴格，不會
 * 讓它漏看。代價是多行樣板字串裡以 `//` 開頭的那幾行也會被剝掉——字串本來就不會執行。
 */
function code(text: string): string {
  const kept: string[] = []
  let inBlock = false
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false
      continue
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlock = true
      continue
    }
    if (trimmed.startsWith('//')) continue
    kept.push(line)
  }
  return kept.join('\n')
}

/** `tests/unit/workflows/` 底下的測試檔，相對於專案根目錄。 */
function workflowTestFiles(): string[] {
  return readdirSync(resolve(process.cwd(), WORKFLOW_TESTS_DIR))
    .filter(name => name.endsWith('.test.ts'))
    .sort()
    .map(name => `${WORKFLOW_TESTS_DIR}/${name}`)
}

/** 第一行有內容的文字；整份都是空白時回空字串。 */
const firstMeaningfulLine = (text: string) =>
  text.split('\n').map(line => line.trim()).find(line => line !== '') ?? ''

/**
 * 靜態 import 的模組名。多行 import 與 `import type` 都認得。
 *
 * 只認靜態 import 是刻意的：動態 `import(...)` 由下面另一條擋掉，撈不到的東西不能
 * 沉默地當成「沒有」——那正是 ci-runner-config.test.ts 說的「部分解析成功」陷阱。
 */
function importedModules(text: string): string[] {
  const pattern = /^[ \t]*import\b(?:[\s\S]*?\bfrom\b)?\s*(['"])([^'"]+)\1/gm
  return [...text.matchAll(pattern)].map(match => match[2]!)
}

const files = workflowTestFiles()

describe('workflow 測試跑在 node 環境，不啟動 Nuxt', () => {
  // 錨點：掃不到檔案的話，下面所有 it.each 會集體真空通過。
  it('掃得到這個目錄下的測試檔', () => {
    expect(files.length).toBeGreaterThanOrEqual(5)
  })

  // Given tests/unit/workflows/ 底下的測試不需要 Nuxt 環境
  // When  執行 pnpm test
  // Then  那些測試不啟動 Nuxt
  //
  // 要求擺在「第一行」而不是「檔案裡有這串字」：vitest 掃的是全文（見 NODE_PRAGMA
  // 那段），所以「有這串字」這種寬鬆條件等於沒條件——寫在檔案中段、甚至寫進散文裡
  // 都會生效，讀的人卻看不出這個檔案換了環境。逐字比對，`node` 拼錯或寫成
  // `happy-dom` 都要紅。
  it.each(files)('%s 第一行宣告 node 環境', (file) => {
    expect(firstMeaningfulLine(read(file))).toBe(NODE_PRAGMA)
  })

  // 宣告 node 環境只有在「這些測試真的不需要 Nuxt」時才是對的。這條守住那個前提：
  // 只要有人在這個目錄下寫需要 Vue / Nuxt / DOM 的測試，就會紅在這裡，而不是紅成
  // 一個難以理解的執行期錯誤。
  it.each(files)('%s 只 import node 內建模組與 vitest', (file) => {
    const modules = importedModules(code(read(file)))
    expect(modules.length).toBeGreaterThan(0)
    expect(modules.filter(name => !name.startsWith('node:') && name !== 'vitest')).toEqual([])
  })

  // Then 那些測試……不發出任何對外網路請求
  //
  // 環境那一半由上面的 pragma 顧；這一條顧測試本身。node 內建的網路模組與 fetch 都
  // 不該出現——`fetch-issue-images.test.ts` 的 spawnSync 跑的是本機 shell script，
  // 它把假的 gh / curl 放到 PATH 前面，沒有真的連外。
  //
  // 動態 import 一併擋掉：撈不到的相依關係會讓上面那條的白名單沉默地漏看。
  it.each(files)('%s 不碰網路，也不用動態 import', (file) => {
    const text = code(read(file))
    expect(importedModules(text).filter(name => /^node:(http|https|net|tls|dns)$/.test(name))).toEqual([])
    expect(text).not.toMatch(/\bfetch\s*\(/)
    expect(text).not.toMatch(/\bXMLHttpRequest\b/)
    expect(text).not.toMatch(/(?<![.\w])import\s*\(/)
  })

  // 上面全是靜態掃描——它們證明「宣告寫對了」，不證明「宣告有效」。這一條才是執行期
  // 的證據：本檔就在這個目錄下、用同一行 pragma，nuxt 環境下 document 一定是物件，
  // node 環境下一定不存在。它綠，代表第一行真的被 vitest 吃進去了。
  //
  // 「真的被吃進去」這件事驗證過：把本檔第一行拿掉，這條就會紅成
  // `expected 'object' to be 'undefined'`（見 PR 說明的手動變異）。能這樣驗的前提是
  // 上面 NODE_PRAGMA 那段——全檔只有第一行帶著那個標記。
  it('本檔自己就跑在 node 環境：沒有 document / window', () => {
    expect(typeof document).toBe('undefined')
    expect(typeof window).toBe('undefined')
  })
})

// `tests/unit/server/` 底下的測試同樣一支都不碰 Vue / Nuxt / DOM——它們拿假的 Prisma
// Client 呼叫 server/utils 的純函式。原本沒有納入守備範圍，代價已經付過一次：
// `google-login.test.ts` 在 main 上以 `Hook timed out in 10000ms` 掛掉整個檔案
// （形態正是本檔開頭描述的那一種），只因為它沒有那一行 pragma。
//
// 這裡的白名單條件與 workflows 那組不同：那些檔案只讀檔案做文字比對，所以可以嚴格到
// 「只准 node: 與 vitest」；這些檔案要 import 受測的 server/utils 與型別，能守的是
// 反面——不准出現只有 Nuxt 環境才給得起的東西。
const SERVER_TESTS_DIR = 'tests/unit/server'

/** 只有 Nuxt 環境才提供的模組。出現任何一個，就代表 node 環境的宣告是錯的。 */
const NUXT_RUNTIME_MODULES = /^(vue$|vue\/|@vue\/|@nuxt\/|#app|#imports|#build)/

function serverTestFiles(): string[] {
  return readdirSync(resolve(process.cwd(), SERVER_TESTS_DIR))
    .filter(name => name.endsWith('.test.ts'))
    .sort()
    .map(name => `${SERVER_TESTS_DIR}/${name}`)
}

const serverFiles = serverTestFiles()

describe('server 測試跑在 node 環境，不啟動 Nuxt', () => {
  // 錨點：掃不到檔案的話，下面的 it.each 會集體真空通過。
  it('掃得到這個目錄下的測試檔', () => {
    expect(serverFiles.length).toBeGreaterThanOrEqual(5)
  })

  it.each(serverFiles)('%s 第一行宣告 node 環境', (file) => {
    expect(firstMeaningfulLine(read(file))).toBe(NODE_PRAGMA)
  })

  // 與上一條互為前提：宣告 node 環境只有在「這些測試真的不需要 Nuxt」時才是對的。
  // 有人在這個目錄下寫了需要元件掛載的測試，會紅在這裡，而不是紅成一個難以理解的
  // 執行期錯誤（或更糟：紅成上面那種整檔逾時）。
  it.each(serverFiles)('%s 不 import 只有 Nuxt 環境才給得起的模組', (file) => {
    const modules = importedModules(code(read(file)))

    expect(modules.length).toBeGreaterThan(0)
    expect(modules.filter(name => NUXT_RUNTIME_MODULES.test(name))).toEqual([])
    // 相對路徑鑽進 app/ 的一律擋掉：那底下全是 Vue 元件與 composable
    expect(modules.filter(name => /(^|\/)app\//.test(name))).toEqual([])
  })
})

// Given 走建議做法 A
// When  檢查 vitest.config.ts
// Then  未變動——ci-runner-config.test.ts 的白名單斷言不需要放寬
describe('vitest.config.ts：沒有改走做法 B', () => {
  // 「未變動」不逐字鎖整份檔案：ci-runner-config.test.ts 有一整組「不該誤紅」的案例，
  // 明講 environment、setupFiles、coverage 之類的調整是正當的，逐字鎖會直接打架。
  // 這條鎖的是「未變動」的實質內容——沒有改用 per-glob 的環境路由把 Nuxt 分流掉，
  // 因為那條路才需要動到 #32 那幾條斷言。exclude / include / dir 那一側由
  // ci-runner-config.test.ts 顧，這裡不重複。
  it('預設環境仍是 nuxt，沒有 environmentMatchGlobs / projects / workspace', () => {
    const config = read('vitest.config.ts')
    expect(config).toContain(`environment: 'nuxt'`)
    expect(config).not.toMatch(/\benvironmentMatchGlobs\b/)
    expect(config).not.toMatch(/\bprojects\b/)
    expect(config).not.toMatch(/\bworkspace\b/)
  })
})

// Given 修改後
// When  執行 pnpm test
// Then  既有的測試全部仍然通過，斷言內容未被放寬
//
// 「全部仍然通過」由 pnpm test 自己回答（結果附在 PR 說明）。機械可查的是另一半：
// 這次改動的失敗形態正好是「94 passed | 33 skipped」，所以把「用 skip 讓紅的變不紅」
// 這條路堵死——CLAUDE.md 的「絕對禁止」本來就列了它，這裡把它變成會紅的斷言。
describe('沒有任何 unit 測試被跳過或獨佔', () => {
  const UNIT_TESTS_DIR = 'tests/unit'

  // 用組出來的字串而不是寫死 `.skip(`：寫死的話這支測試會掃到自己的原始碼而永遠紅。
  const FORBIDDEN = ['only', 'skip', 'skipIf', 'todo', 'runIf'].map(name => `.${name}(`)

  function testFilesUnder(dir: string): string[] {
    return readdirSync(resolve(process.cwd(), dir)).flatMap((name) => {
      const relative = join(dir, name)
      if (statSync(resolve(process.cwd(), relative)).isDirectory()) return testFilesUnder(relative)
      return name.endsWith('.test.ts') ? [relative] : []
    })
  }

  const unitTests = testFilesUnder(UNIT_TESTS_DIR).sort()

  it('掃得到 tests/unit 底下的測試檔', () => {
    expect(unitTests.length).toBeGreaterThanOrEqual(files.length)
  })

  it.each(unitTests)('%s 沒有 skip / only', (file) => {
    const text = code(read(file))
    expect(FORBIDDEN.filter(marker => text.includes(marker))).toEqual([])
  })
})
