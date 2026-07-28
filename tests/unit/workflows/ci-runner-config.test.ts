// @vitest-environment node
// 純文字比對，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// issue #32：ci-checks.test.ts 只鎖到「ci.yml 的 test 步驟逐字是 `pnpm test`」為止。
// 但 `pnpm test` 展開成什麼由 package.json 說了算，要收哪些檔又由 vitest.config.ts
// 說了算，那兩層沒有任何斷言守著。重要性來自 #22 的原始論證：CI 的意義是「獨立於
// agent 的第二個來源」，如果 agent 能改動決定那個來源怎麼跑的設定，它就不再獨立。
//
// 已知的結構性上限（#32 明列為範圍外，細節留在 issue）：守得住的是「單獨改一邊」。
// 同時改 package.json 與 exclude 兩邊，這支自己也會被排除掉，只能靠 review diff。

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

const isQuote = (ch: string | undefined) => ch === '\'' || ch === '"' || ch === '`'

/** 從引號起點跳到字串結束的下一個位置；沒有收尾引號時回 -1。 */
function skipString(text: string, start: number): number {
  const quote = text[start]
  let i = start + 1
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2
      continue
    }
    if (text[i] === quote) return i + 1
    i++
  }
  return -1
}

/**
 * 剝掉註解，而且要認得字串。
 *
 * 不能用「整行 //」了事：行尾註解與區塊註解都能在真正的設定之前塞進誘餌，
 * 讓比對跑去看那一段。也不能直接對整份文字做正則剝除——glob 樣式裡含有會被
 * 誤認成區塊註解起訖的字元，不先跳過字串就會從中間剖開。所以逐字掃。
 */
function code(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    if (isQuote(text[i])) {
      const end = skipString(text, i)
      if (end === -1) return out + text.slice(i)
      out += text.slice(i, end)
      i = end
      continue
    }
    if (text[i] === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (text[i] === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      out += ' ' // 別讓兩側的 token 黏在一起
      i += 2
      continue
    }
    out += text[i]
    i++
  }
  return out
}

/** package.json 的 scripts.test。 */
const testScript = (text: string): unknown => JSON.parse(text).scripts?.test

/** 從 `{` 的位置做括號配對，回傳大括號之間的文字；配不起來回 null。 */
function braceBody(text: string, open: number): string | null {
  let depth = 0
  let i = open
  while (i < text.length) {
    if (isQuote(text[i])) {
      const end = skipString(text, i)
      if (end === -1) return null
      i = end
      continue
    }
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i)
    i++
  }
  return null
}

/**
 * 物件字面值的第一層 key → value 原文。巢狀的物件與陣列整塊當成 value 帶過，
 * 所以 `coverage: { exclude: [...] }` 不會被誤認成 `test.exclude`。
 *
 * 看不懂就回 null：spread、computed key、括號不成對、同層重複 key 都算。
 * 這個解析器唯一的用途是餵給白名單斷言，「沉默地少看見一項」比「失敗」危險得多。
 */
function topLevelEntries(body: string): Map<string, string> | null {
  const entries = new Map<string, string>()
  let i = 0
  while (i < body.length) {
    if (/[\s,]/.test(body[i]!)) {
      i++
      continue
    }
    const key = /^(?:([A-Za-z_$][\w$]*)|(['"])([A-Za-z_$][\w$]*)\2)\s*:/.exec(body.slice(i))
    if (!key) return null
    const name = key[1] ?? key[3]!
    if (entries.has(name)) return null
    i += key[0].length

    const start = i
    let depth = 0
    while (i < body.length) {
      if (isQuote(body[i])) {
        const end = skipString(body, i)
        if (end === -1) return null
        i = end
        continue
      }
      const ch = body[i]!
      if (ch === '{' || ch === '[' || ch === '(') depth++
      else if (ch === '}' || ch === ']' || ch === ')') {
        if (depth === 0) return null
        depth--
      }
      else if (ch === ',' && depth === 0) break
      i++
    }
    entries.set(name, body.slice(start, i).trim())
  }
  return entries
}

/**
 * vitest.config.ts 裡 `test:` 那個物件的第一層設定。
 *
 * 不 import 這份 config：它是 TS 模組，import 會把 defineVitestConfig 連同
 * @nuxt/test-utils 一起拉進來，而我們只要那幾個 key。純文字比對與既有的
 * workflow 測試同一套做法，也不必為此新增依賴。
 *
 * 只認第一層，是因為「unit 測試收不收得進來」只由第一層決定；coverage 之類的
 * 巢狀區塊帶自己的 include / exclude 是完全正當的事，不該被這裡誤傷。
 */
function testOptions(text: string): Map<string, string> | null {
  const source = code(text)
  const hits = [...source.matchAll(/\btest\s*:/g)]
  if (hits.length !== 1) return null
  const rest = source.slice(hits[0]!.index + hits[0]![0].length)
  const open = rest.search(/\S/)
  if (open === -1 || rest[open] !== '{') return null
  const body = braceBody(rest, open)
  return body === null ? null : topLevelEntries(body)
}

/** 一個引號字串。不吃反斜線，有跳脫就讓它落到下面的「還有殘留」檢查去。 */
const stringLiteral = () => /(['"`])([^'"`\\]*)\1/g

/**
 * `test.exclude` 的字面字串，逐項取出；解析不出來回 null 而不是空陣列。
 *
 * 「部分解析成功」才是真正危險的情況：`[...EXTRA]`、`[].concat(EXTRA)` 這種寫法
 * 裡撈得到的只有字面字串，回傳的會是一個「看起來很正常」的短陣列，白名單照樣
 * 通過，而多出來的排除項一條都沒被看見。所以撈完要再確認陣列裡沒有別的東西。
 */
function excludeEntries(text: string): string[] | null {
  const value = testOptions(text)?.get('exclude')
  if (value === undefined) return null
  const array = /^\[([\s\S]*)\]$/.exec(value)
  if (!array) return null
  const inner = array[1]!
  if (/[^\s,]/.test(inner.replace(stringLiteral(), ''))) return null
  return [...inner.matchAll(stringLiteral())].map(entry => entry[2]!)
}

/** 目前 vitest.config.ts 的 exclude，也是唯二安全的兩項。 */
const SAFE_EXCLUDES = ['**/node_modules/**', '**/tests/e2e/**']

/** 除了 exclude 之外，同樣能縮小「收哪些檔」的 key。 */
const NARROWING_KEYS = ['include', 'dir', 'projects', 'workspace']

/** 這份 config 在 test 的第一層用了哪些會縮限收檔範圍的 key；解析不出來回 null。 */
function narrowingKeysIn(text: string): string[] | null {
  const options = testOptions(text)
  return options === null ? null : NARROWING_KEYS.filter(key => options.has(key))
}

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
  // 只挑「決定收哪些檔」的 key，而且只看 test 的第一層——environment、setupFiles、
  // coverage 之類的照樣能改，這條不是拿來把整份 config 鎖死的。
  it('沒有另外用 include / dir / projects / workspace 縮限收檔範圍', () => {
    expect(narrowingKeysIn(read('vitest.config.ts'))).toEqual([])
  })
})

// ── 變異：解析器的回歸保護 ──
//
// 這個 issue 沒有自然的紅燈：被驗的東西現在就已經處於正確狀態，斷言寫完第一次跑
// 就是綠的，沒有東西可以「實作」讓它轉綠。所以改用變異——把 config 改壞，確認
// 讀出來的結果會讓上面兩條斷言不成立。
//
// 但要說清楚這一組「證明了什麼」：它餵的是合成字串，測到的是解析器，不是真實
// 檔案上的不變量。上一輪的三個繞道情境（spread、行尾註解誘餌、coverage 巢狀
// exclude）在這一組底下全部是綠的，因為那些 case 從來沒被餵進來過——所以它
// **不能**當作「斷言有效」的證明。斷言有效性的證明是真實檔案上的手動變異
// （改壞 → 看紅 → 還原 → 看綠），記在 PR 說明裡。
//
// 這一組的價值是：日後有人重寫解析函式時，這些已知的繞道不會悄悄復活。

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

  // ── 排除項不是字面字串：撈不出來的那幾項會整個隱形 ──
  //
  // 「解析不出來回 null」這條防線只在**完全**解析不出來時才會被觸發。部分解析成功
  // 才是危險的：回的是一個「看起來很正常」的短陣列，白名單比對照樣通過，而多出來
  // 的排除項一條都沒被看見。這不像作弊，看起來就是一次普通重構。
  it.each([
    ['spread 變數', `    exclude: ['**/node_modules/**', '**/tests/e2e/**', ...EXTRA],\n`],
    ['concat', `    exclude: ['**/node_modules/**', '**/tests/e2e/**'].concat(EXTRA),\n`],
    ['整個換成變數參照', `    exclude: EXCLUDE,\n`],
    ['三元式', `    exclude: CI ? ['**/node_modules/**'] : ['**/node_modules/**', '**/tests/e2e/**'],\n`],
  ])('exclude 含非字面值（%s）→ 解析回 null，不是那幾個撈得到的', (_label, line) => {
    expect(excludeEntries(configWith(`    environment: 'nuxt',\n${line}`))).toBeNull()
  })

  // ── 誘餌：在真正的 exclude 之前擺一段「長得像安全設定」的文字 ──
  //
  // 只剝整行註解的話，行尾註解會留在文字裡；解析又只取第一筆命中。
  // 兩件事湊起來，白名單就會跑去比對那段誘餌，真正生效的那行完全沒被看到。
  it('行尾註解裡的誘餌 exclude 不會被當成真的那一個', () => {
    const inner = `    environment: 'nuxt', // 預設 exclude: ['**/node_modules/**', '**/tests/e2e/**']\n`
      + `    exclude: ['**/node_modules/**', '**/tests/e2e/**', '**/tests/unit/workflows/agent-*'],\n`
    expect(excludeEntries(configWith(inner))).not.toEqual(SAFE_EXCLUDES)
  })

  // 同層寫兩次 exclude 是合法 JS，後面那個生效。解析取第一筆就會看錯對象。
  it('同一層出現兩個 exclude → 解析回 null', () => {
    const inner = `    environment: 'nuxt',\n${excludeLine(SAFE_EXCLUDES)}`
      + `    exclude: ['**/tests/unit/**'],\n`
    expect(excludeEntries(configWith(inner))).toBeNull()
  })

  // exclude 鎖住而 include 沒鎖等於白鎖：這條證明 include 那條斷言有鑑別力。
  it('test 第一層加上 include → 被 narrowingKeysIn 抓到', () => {
    const inner = `    environment: 'nuxt',\n    include: ['tests/unit/index.test.ts'],\n${excludeLine(SAFE_EXCLUDES)}`
    expect(narrowingKeysIn(configWith(inner))).toContain('include')
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
    // coverage 幾乎一定會帶自己的 include / exclude，而那是巢狀的另一層，
    // 與「unit 測試收不收得進來」無關。這兩個是完全正當的改動。
    ['coverage 帶自己的 exclude', `    environment: 'nuxt',\n    coverage: { reporter: ['text'], exclude: ['**/*.config.ts'] },\n${excludeLine(SAFE_EXCLUDES)}`],
    ['coverage 帶自己的 include', `    environment: 'nuxt',\n    coverage: { include: ['app/**'] },\n${excludeLine(SAFE_EXCLUDES)}`],
    ['exclude 改成多行排版', `    environment: 'nuxt',\n    exclude: [\n      '**/node_modules/**',\n      '**/tests/e2e/**',\n    ],\n`],
    ['把別的 exclude 寫法註解起來', `    environment: 'nuxt',\n    // exclude: ['**/tests/unit/**'],\n${excludeLine(SAFE_EXCLUDES)}`],
    // 區塊註解引述到 exclude 這個字，不該讓解析跑去比對註解裡那一段。
    ['區塊註解裡提到 exclude', `    environment: 'nuxt',\n    /* 這裡不要再加 exclude: [] 之類的東西 */\n${excludeLine(SAFE_EXCLUDES)}`],
    ['行尾註解裡提到 exclude', `    environment: 'nuxt',\n${excludeLine(SAFE_EXCLUDES).replace('\n', ' // 不要加 exclude: 的東西\n')}`],
  ])('%s 不會誤紅', (_label, inner) => {
    const config = configWith(inner)
    expect(excludeEntries(config)).toEqual(SAFE_EXCLUDES)
    expect(narrowingKeysIn(config)).toEqual([])
  })
})
