// @vitest-environment node
// 純文字比對，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it } from 'vitest'
import { blockOf } from '../support/spec-source'

// issue #102：`home.spec.ts` 的「向下捲動後頁首收合，固定區高度明顯縮小」在 main 上失敗——
//
//   Expected: 0
//   Received: 2
//
// 那 2px 是實作的缺陷（副標的 `pt-0.5` 撐住 0fr 的軌道），不是斷言寫錯：
// 「整塊收到 0 高」是 issue #55 定下來的驗收條件。issue 因此明確要求
// **不要改測試斷言**（例如放寬成 `toBeLessThan(3)`）。
//
// 最省事的假綠就是回頭改那一行，而 E2E 不在 TDD Develop 的 job 內執行，
// 改了在這裡不會有人紅。這支測試把那條斷言釘住：放寬就紅。

const HOME_SPEC = 'tests/e2e/home.spec.ts'
const COLLAPSE_TEST = '向下捲動後頁首收合，固定區高度明顯縮小'
const EXPANDED_TEST = '展開時缸副標仍是單行省略，與缸名之間的間距不變'

/**
 * 取出「量某個 slot 的 boundingBox 高度」之後接的那個 matcher，例如 `toBe(0)`。
 *
 * 直接的 `expect(...).toBe(0)` 與跨行的 `expect.poll(...).toBe(0)` 長得不一樣，
 * 先把空白壓平，兩種寫法就落在同一個形狀上。
 */
function heightMatcher(block: string, testId: string): string {
  const pattern = new RegExp(`getByTestId\\('${testId}'\\)\\.boundingBox\\(\\)\\)!\\.height\\)\\s*\\.(\\w+\\([^)]*\\))`)
  const match = block.replace(/\s+/g, ' ').match(pattern)

  expect(match, `找不到量 ${testId} 高度的斷言`).not.toBeNull()

  return match![1]!
}

// Given 上述修好 / When 執行 home.spec.ts 的「向下捲動後頁首收合，固定區高度明顯縮小」
// Then 該 test 在不放寬任何斷言的前提下通過
describe('home.spec.ts 的收合高度斷言沒有被放寬', () => {
  it('副標讓位區塊量的仍是「等於 0」，不是「小於某個容忍值」', () => {
    expect(heightMatcher(blockOf(HOME_SPEC, COLLAPSE_TEST), 'tank-subtitle-slot')).toBe('toBe(0)')
  })

  // 對照組本來就收得到 0；它一起被放寬的話，「兩個 slot 一致」這個驗收條件就沒有基準了
  it('對照組的六格數字量的也仍是「等於 0」', () => {
    expect(heightMatcher(blockOf(HOME_SPEC, COLLAPSE_TEST), 'water-readings-slot')).toBe('toBe(0)')
  })
})

// Given 頁首處於展開狀態 / When 畫面渲染
// Then 缸副標與缸名之間的間距與現在一致，副標仍為單行省略（truncate）
//
// 這一條只有真的排版得出來的瀏覽器驗得到，unit 這一側守的是「spec 有在驗它」。
describe('home.spec.ts 有驗展開時的副標樣態', () => {
  const block = blockOf(HOME_SPEC, EXPANDED_TEST)

  it('驗了上方間距仍是 2px', () => {
    expect(block).toContain('paddingTop')
    expect(block).toContain('2px')
  })

  it('驗了副標仍是單行省略', () => {
    expect(block).toContain('nowrap')
    expect(block).toContain('ellipsis')
  })
})
