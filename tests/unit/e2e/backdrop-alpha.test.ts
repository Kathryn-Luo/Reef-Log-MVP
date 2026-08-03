// @vitest-environment node
// 純函式與純文字比對，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { alphaOf } from '../../e2e/support/css-colour'

// issue #97：`home.spec.ts`「點擊水質摘要列升起儀表板，背景首頁仍看得見」在 preview 上
// 必然失敗——不是遮罩壞了，是那條斷言把 CSS 顏色的**字串格式**綁死成 `rgba(...)`：
//
//   Expected pattern: /rgba\(.+,\s*0?\.\d+\)$/
//   Received string:  "oklab(0 0 0 / 0.6)"
//
// Tailwind v4 的 `bg-black/60` 走 `color-mix()` 在 oklab 色彩空間算，computed value 因此
// 不再是 `rgba()`。alpha 明明就是 0.6，行為與 Story 一致。
//
// 這一輪把「驗字串長相」換成「驗解析出來的 alpha」。驗收的主體（遮罩真的半透明）只有
// E2E 跑得出來，而 E2E 不在 TDD Develop 的 job 內執行，所以這裡分兩半守：
//   ① 換算本身是純函式（`alphaOf`），可以直接餵各種顏色函式進去驗——這是這次修法的核心
//   ② 那條 spec 真的改用了它，而且沒有被降級成恆真斷言（純文字比對）

// ── ① 換算：alpha 落在哪個值，與顏色函式叫什麼名字無關 ──────────────────

describe('alphaOf：從任一種 CSS 顏色字串解析出 alpha', () => {
  // Given 遮罩以 bg-black/60 呈現，瀏覽器可能回傳 rgba() 或 oklab() 等任一種格式
  // Then  同樣是 60% 不透明度，解析出來都是 0.6，不因函式名稱而不同
  //
  // 逐一列舉格式是這條測試的工作，不是被測程式的工作：`alphaOf` 認的是 CSS 放 alpha 的
  // 兩個位置（現代語法的 `/ alpha`、舊語法四個逗號分量的最後一個），與函式名無關。
  // 這裡列出來的每一種，都是同一段解析邏輯的不同輸入。
  it.each([
    ['rgba(0, 0, 0, 0.6)', 0.6],
    ['rgb(0 0 0 / 0.6)', 0.6],
    ['oklab(0 0 0 / 0.6)', 0.6], // 實際失敗訊息裡收到的那一個
    ['oklch(0.5 0.1 200 / 0.6)', 0.6],
    ['hsla(0, 0%, 0%, .6)', 0.6],
    ['color(srgb 0 0 0 / 0.6)', 0.6],
    ['lab(0 0 0 / 60%)', 0.6], // 百分比寫法
    ['#00000099', 0.6], // 153/255
  ])('%s 的 alpha 是 %s', (colour, alpha) => {
    expect(alphaOf(colour)).toBeCloseTo(alpha, 5)
  })

  // 不透明與全透明都要算得出來——否則「0 < alpha < 1」這個斷言就失去鑑別力：
  // 遮罩若哪天真的變成全黑或整個消失，測試必須紅。
  it.each([
    ['rgb(0, 0, 0)', 1],
    ['oklab(0 0 0)', 1],
    ['#000000', 1],
    ['red', 1],
    ['transparent', 0],
    ['rgba(0, 0, 0, 0)', 0],
  ])('%s 的 alpha 是 %s', (colour, alpha) => {
    expect(alphaOf(colour)).toBe(alpha)
  })

  // 解析不出來就要吵——沉默地回一個 1 或 0 會讓上層的斷言紅得莫名其妙，
  // 沉默地回「像是半透明」的值則會讓它假綠。
  it('解析不出 alpha 時丟出帶著原字串的錯誤', () => {
    expect(() => alphaOf('oklab(0 0 0 / ???)')).toThrow('oklab(0 0 0 / ???)')
    // 巢狀的顏色函式（例如未被瀏覽器換算掉的 color-mix()）不猜，直接丟
    expect(() => alphaOf('color-mix(in oklab, rgb(0 0 0 / 0.6) 50%, transparent)'))
      .toThrow('color-mix')
  })
})

// ── ② 那條 spec 真的改用了它 ────────────────────────────────────────────

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

const HOME_SPEC = 'tests/e2e/home.spec.ts'
const SUPPORT = 'tests/e2e/support/css-colour.ts'

/** 把一支 spec 切成「一個 test 一段」（同 guest-login-spec.test.ts） */
function testBlocks(source: string): string[] {
  return source.split(/\n(?=[ \t]*test(?:\.\w+)?\()/)
}

/** 取出標題含 `title` 的那一段 */
function blockOf(file: string, title: string): string {
  const block = testBlocks(read(file)).find(candidate => candidate.includes(title))

  expect(block, `${file} 找不到「${title}」這條 test`).toBeDefined()

  return block!
}

const TITLE = '點擊水質摘要列升起儀表板，背景首頁仍看得見'

describe('home.spec.ts —「背景首頁仍看得見」驗的是 alpha，不是字串長相', () => {
  // Given 遮罩以 bg-black/60 呈現，瀏覽器可能回傳任一種格式
  // Then  斷言不因顏色函式名稱不同而失敗——寫死函式名的 pattern 不該再出現
  it('不再比對 rgba() 這種寫死函式名的字串', () => {
    const block = blockOf(HOME_SPEC, TITLE)

    expect(block).not.toMatch(/rgba\\\(/)
    expect(block).not.toContain('toMatch')
  })

  // When 測試讀取遮罩的 computed backgroundColor
  //
  // 讀取本身搬進了 support 模組（那裡才有瀏覽器），所以兩邊各驗一半：spec 仍然指名
  // 那個遮罩，support 仍然讀的是它的 computed backgroundColor。
  it('仍然讀遮罩的 computed backgroundColor', () => {
    expect(blockOf(HOME_SPEC, TITLE)).toContain('water-dashboard-backdrop')
    expect(read(SUPPORT)).toContain('getComputedStyle')
    expect(read(SUPPORT)).toContain('backgroundColor')
  })

  // Then 斷言驗的是解析出來的 alpha 落在 0 與 1 之間（半透明）
  //
  // 兩邊都要：只驗 `> 0` 的話，遮罩變成全黑不透明也會綠；只驗 `< 1` 的話，遮罩整個
  // 消失（alpha 0）也會綠。issue 明講不接受 `toBeTruthy()` 這種恆真斷言。
  it('斷言 alpha 落在 0 與 1 之間', () => {
    const block = blockOf(HOME_SPEC, TITLE)

    expect(block).toMatch(/expect\(alpha\)\.toBeGreaterThan\(0\)/)
    expect(block).toMatch(/expect\(alpha\)\.toBeLessThan\(1\)/)
    expect(block).not.toContain('toBeTruthy')
  })

  // 這條 test 的其餘驗收條件不因為這次修法而被順手拿掉。
  it('同一條 test 的其他斷言原封不動', () => {
    const block = blockOf(HOME_SPEC, TITLE)

    expect(block).toContain('water-dashboard-title')
    expect(block).toContain('water-dashboard-sheet')
    expect(block).toContain('主缸 · 4 尺')
  })
})

// 「整條 test 被刪掉」是讓紅的變不紅最省事的走法，堵掉。
describe('home.spec.ts 的 test 都還在', () => {
  // 用「不少於」而不是逐字鎖住 34：上面 blockOf 那幾條已經擋住「這條 test 被刪掉」，
  // 這裡守的是旁邊的鄰居。home.spec.ts 還在長，逐字鎖只會讓下一個加 test 的人被迫改這裡。
  it('仍然至少有 34 條 test，沒有被刪掉或跳過', () => {
    const source = read(HOME_SPEC)

    expect((source.match(/^[ \t]*test\(/gm) ?? []).length).toBeGreaterThanOrEqual(34)
    // 只擋「整條 test 被宣告成 skip / only」——`test.skip(browserName !== 'chromium', …)`
    // 那種帶條件的用法是正當的（home.spec.ts:668 就有一個：CDP 的觸控事件只有 Chromium
    // 給得起），逐字禁掉 `test.skip` 會把它一起判死。
    expect(source).not.toMatch(/test\.(skip|only)\s*\(\s*['"`]/)
  })
})
