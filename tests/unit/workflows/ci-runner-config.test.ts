import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// issue #32：ci-checks.test.ts 只鎖到「ci.yml 的 test 步驟逐字是 `pnpm test`」為止。
//
// 但 `pnpm test` 展開成什麼由 package.json 說了算，要收哪些檔又由 vitest.config.ts
// 說了算，那兩層沒有任何斷言守著。兩條路都能讓 CI 保持綠燈，而 ci-checks.test.ts
// 完全看不到：
//   1. `"test": "vitest run --passWithNoTests"`
//      → vitest 預設在「一個測試都沒收到」時 exit 1，正是那個預設在擋「測試檔全刪」；
//        加上這個旗標，全刪也會綠
//   2. exclude 加一行 `**/tests/unit/**`
//      → 所有 unit 測試都不會被收進來，CI 仍然綠
//
// 這件事的重要性來自 #22 的原始論證：CI 存在的意義是「獨立於 agent 的第二個來源」。
// 如果 agent 能改動決定那個來源怎麼跑的設定，第二個來源就不再獨立。
//
// 放在 ci-checks.test.ts 旁邊，因為守的是同一件事的下一層，只是被驗的檔案
// 從 .github/workflows/ci.yml 換成 package.json 與 vitest.config.ts。
//
// 已知的結構性上限（#32 明列為範圍外）：CI 驗的是「現存的測試會過」，不是
// 「該有的測試存在」。刪掉部分測試檔仍然是綠的，那件事沒有純 CI 解。
//
// 這支自己還有一個上限，是做變異時實測出來的：**測試守不住自己有沒有被收進來**。
//   - 只動 exclude（加 `**/tests/unit/**`）→ 這支跟著被排除、一條斷言都不會跑，
//     但 vitest 在「一個測試都沒收到」時 exit 1，CI 仍然紅。擋下來的是 vitest 的預設。
//   - 只動 package.json（加 --passWithNoTests）→ 這支照常被收進來，下面第一條斷言紅。
//   - **兩個一起動** → 沒有測試被收進來，而 --passWithNoTests 讓 exit code 是 0，
//     兩條斷言都沒有機會執行，CI 綠。
// 也就是說這裡守的是「單獨改一邊」，那正是 #32 列出的兩條失效情境；
// 同時改兩邊只能靠 review `.github/**`、`tests/**`、`package.json` 與
// `vitest.config.ts` 的 diff，沒辦法從測試套件內部擋。

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

/** 剝掉整行註解：註解會引述被禁止的字串本身，純文字比對會誤中散文。 */
const code = (text: string) =>
  text
    .split('\n')
    .filter(line => !/^\s*\/\//.test(line))
    .join('\n')

/** package.json 的 scripts.test。 */
const testScript = (text: string): unknown => JSON.parse(text).scripts?.test

/**
 * vitest.config.ts 的 `test.exclude` 陣列字面值，逐項取出。
 *
 * 不 import 這份 config：它是 TS 模組，import 會把 defineVitestConfig 連同
 * @nuxt/test-utils 一起拉進來，而我們只要那一個陣列。純文字比對與既有的
 * workflow 測試同一套做法，也不必為此新增依賴。
 *
 * 解析不出來時回 null 而不是空陣列——空陣列會讓下面的斷言真空通過。
 */
function excludeEntries(text: string): string[] | null {
  const matched = /\bexclude:\s*\[([^\]]*)\]/.exec(code(text))
  if (!matched) return null
  return [...matched[1]!.matchAll(/['"`]([^'"`]*)['"`]/g)].map(entry => entry[1]!)
}

/** 目前 vitest.config.ts 的 exclude，也是唯二安全的兩項。 */
const SAFE_EXCLUDES = ['**/node_modules/**', '**/tests/e2e/**']

describe('package.json：pnpm test 就是 vitest run', () => {
  // Given scripts.test 是 "vitest run" / When 執行 pnpm test / Then 測試通過
  //
  // 逐字比對，比照 ci-checks.test.ts 對 ci.yml 步驟的做法。任何附加旗標都要紅：
  // --passWithNoTests 之外，`vitest run tests/unit/foo.test.ts`（縮限範圍）、
  // `vitest run || true`（吞掉失敗）走的都是同一個洞。
  it('scripts.test 逐字是 vitest run，沒有附加旗標', () => {
    expect(testScript(read('package.json'))).toBe('vitest run')
  })
})

describe('vitest.config.ts：unit 測試都收得進來', () => {
  // Given 有人在 exclude 加入會排除 tests/unit 的樣式 / Then 必須有測試失敗
  //
  // 用白名單而不是「不含 tests/unit 字樣」：後者只擋得掉字面上寫死的那一種，
  // `**/unit/**`、`tests/**`、`**/*.test.ts` 一樣把 unit 測試清空卻不會被抓到。
  // 白名單是「多一項就紅」，不必預先想像所有寫法。
  it('exclude 只排除 node_modules 與 tests/e2e', () => {
    expect(excludeEntries(read('vitest.config.ts'))).toEqual(SAFE_EXCLUDES)
  })

  // 另一條同樣能縮小收檔範圍的路：把 include 指到剛好會過的那幾個檔，
  // 或用 dir / projects / workspace 換掉整個根目錄。exclude 鎖住而這些沒鎖，等於白鎖。
  //
  // 只挑「決定收哪些檔」的 key——environment、setupFiles、coverage 之類的照樣能改，
  // 這條不是拿來把整份 config 鎖死的。
  it.each(['include', 'dir', 'projects', 'workspace'])(
    '沒有用 %s 另外縮限收檔範圍',
    (key) => {
      expect(code(read('vitest.config.ts'))).not.toMatch(new RegExp(`\\b${key}:`))
    },
  )
})

// ── 變異測試：證明上面兩條真的抓得到 ──
//
// 這個 issue 沒有自然的紅燈：被驗的東西現在就已經處於正確狀態，斷言寫完第一次跑
// 就是綠的，沒有東西可以「實作」讓它轉綠。所以改用變異證明有效——把 config 改壞，
// 確認同一組解析函式讀出來的結果會讓上面的斷言不成立。
//
// 真實檔案上的手動變異（改壞 → 看紅 → 還原 → 看綠）記在 PR 說明裡；
// 這裡把同一件事固定下來，日後有人重寫解析函式時才不會悄悄失去鑑別力。

/** 一份 vitest.config.ts 的文字，`test:` 的內容由呼叫端給。 */
const configWith = (inner: string) => `import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
${inner}  },
})
`

const excludeLine = (entries: string[]) =>
  `    exclude: [${entries.map(entry => `'${entry}'`).join(', ')}],\n`

const CURRENT_INNER = `    environment: 'nuxt',\n${excludeLine(SAFE_EXCLUDES)}`

describe('變異：改壞了就要抓到', () => {
  // 錨點：解析函式讀不出東西的話，下面的 not.toEqual 會集體真空通過。
  it('原樣的 config 解析得出目前這兩項', () => {
    expect(excludeEntries(configWith(CURRENT_INNER))).toEqual(SAFE_EXCLUDES)
  })

  // Given 有人把 scripts.test 改成 "vitest run --passWithNoTests"
  // Then 必須有測試失敗，並指出 scripts.test 被改動
  it.each([
    'vitest run --passWithNoTests',
    'vitest run tests/unit/index.test.ts',
    'vitest run || true',
  ])('scripts.test 被改成 %s → 上面那條不成立', (mutation) => {
    const mutated = JSON.stringify({ scripts: { test: mutation } })
    expect(testScript(mutated)).not.toBe('vitest run')
  })

  // Given 有人在 exclude 加入會排除 tests/unit 的樣式 → Then 必須有測試失敗
  it.each([
    '**/tests/unit/**',
    'tests/unit/**',
    '**/unit/**',
    '**/*.test.ts',
  ])('exclude 多一項 %s → 上面那條不成立', (pattern) => {
    const inner = `    environment: 'nuxt',\n${excludeLine([...SAFE_EXCLUDES, pattern])}`
    expect(excludeEntries(configWith(inner))).not.toEqual(SAFE_EXCLUDES)
  })

  // 整個 exclude 被拿掉也要紅：null 不會等於白名單。
  // （回空陣列的話這裡就會變成 [] !== SAFE_EXCLUDES 也算紅，但真實檔案那條
  //   會分不出「沒有 exclude」與「解析器壞了」，所以回 null 是刻意的。）
  it('exclude 整個消失 → 解析回 null，不是空陣列', () => {
    expect(excludeEntries(configWith(`    environment: 'nuxt',\n`))).toBeNull()
  })
})

// Given 為了正當理由調整 vitest.config.ts 的其他設定（例如 environment、setupFiles）
// When  執行 pnpm test
// Then  不應該誤紅——斷言只針對 exclude，不要把整份 config 鎖死
describe('變異：不該誤紅的改動', () => {
  it.each([
    ['改掉 environment', `    environment: 'happy-dom',\n${excludeLine(SAFE_EXCLUDES)}`],
    ['加上 setupFiles', `    environment: 'nuxt',\n    setupFiles: ['./tests/setup.ts'],\n${excludeLine(SAFE_EXCLUDES)}`],
    ['加上 coverage 區塊', `    environment: 'nuxt',\n    coverage: { reporter: ['text'] },\n${excludeLine(SAFE_EXCLUDES)}`],
    ['exclude 改成多行排版', `    environment: 'nuxt',\n    exclude: [\n      '**/node_modules/**',\n      '**/tests/e2e/**',\n    ],\n`],
    ['把別的 exclude 寫法註解起來', `    environment: 'nuxt',\n    // exclude: ['**/tests/unit/**'],\n${excludeLine(SAFE_EXCLUDES)}`],
  ])('%s 不會誤紅', (_label, inner) => {
    expect(excludeEntries(configWith(inner))).toEqual(SAFE_EXCLUDES)
  })
})
