// @vitest-environment node
// 純文字比對，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it } from 'vitest'
import { blockOf, read } from '../support/spec-source'

// issue #103 的第四條驗收條件：
//
//   Given 上述修好 / When 執行 home.spec.ts 的「還原到已捲動的位置時，首幀直接是
//   收合樣態、不補播收合動畫」/ Then 該 test 在不放寬任何斷言的前提下通過
//
// 「通過」只有 Vercel preview 上的 E2E 驗得到（要真的有瀏覽器、真的重新整理一次），
// 而 E2E 不在 TDD Develop 的 job 內執行。unit 這一側守的是那句「不放寬任何斷言」——
// 最省事的假修法正是把 `data-collapsed` 的期望值改掉、把逐幀量高度那段刪掉，
// 或乾脆把整條 test 換成一個恆真的斷言。這些都擋得住；細節寫錯擋不住，由 E2E 收尾。

const HOME_SPEC = 'tests/e2e/home.spec.ts'
const FIRST_FRAME_TEST = '還原到已捲動的位置時，首幀直接是收合樣態、不補播收合動畫'
const POSITION_TEST = '重新整理後捲動位置回到原本的位置'
const TOP_TEST = '在頂端重新整理時停在頂端，頁首維持展開'

describe('issue #55 的那條 test 沒有被放寬', () => {
  it('仍然先捲過收合門檻，再真的重新整理一次', () => {
    const block = blockOf(HOME_SPEC, FIRST_FRAME_TEST)

    expect(block).toContain('scrollPastCollapse(page)')
    expect(block).toContain('page.reload()')
  })

  it('重新整理後仍然期望 data-collapsed 是 true', () => {
    const block = blockOf(HOME_SPEC, FIRST_FRAME_TEST)
    const afterReload = block.slice(block.indexOf('page.reload()'))

    expect(afterReload).toContain('toHaveAttribute(\'data-collapsed\', \'true\')')
  })

  it('仍然逐幀量高度，確認整段期間都是收合高度', () => {
    const block = blockOf(HOME_SPEC, FIRST_FRAME_TEST)

    expect(block).toContain('sampleDuringCollapse(page, PAST_COLLAPSE)')
    expect(block).toContain('Math.max(...headerHeights)).toBeLessThan(collapsedHeight + 2)')
  })
})

// Given 我在首頁向下捲動到頁首已經收合的位置 / When 我重新整理頁面
// Then 內容到齊之後，捲動位置回到重新整理前的位置，頁首呈收合樣態
describe('捲動位置還原本身有一條 E2E', () => {
  it('比對的是重新整理前後的實際捲動位置', () => {
    const block = blockOf(HOME_SPEC, POSITION_TEST)

    expect(block).toContain('const before = await scrollPastCollapse(page)')
    expect(block).toContain('page.reload()')
    expect(block).toContain('window.scrollY')
    // 位置與樣態都要驗：只驗 collapsed 的話，還原到「別的已收合位置」也會過
    expect(block).toContain('toHaveAttribute(\'data-collapsed\', \'true\')')
  })

  // 收合前後的最大捲動量相差約 108px。容差一旦放到那個量級，「回到原本的位置」
  // 與「掉回頂端附近」就分不出來了——那正是這條 test 唯一要分辨的事
  it('位置的容差小於收合造成的高度差', () => {
    const block = blockOf(HOME_SPEC, POSITION_TEST)
    const tolerance = block.match(/toBeLessThanOrEqual\((\d+)\)/)

    expect(tolerance, '找不到位置容差的斷言').not.toBeNull()
    expect(Number(tolerance![1])).toBeLessThanOrEqual(10)
  })

  // Given 我在首頁頂端（未捲動）/ When 我重新整理頁面 / Then 畫面停在頂端
  it('未捲動時重新整理仍停在頂端，而且是等還原處理完之後才判定', () => {
    const block = blockOf(HOME_SPEC, TOP_TEST)

    expect(block).toContain('page.reload()')
    expect(block).toContain('toHaveAttribute(\'data-animated\', \'true\')')
    expect(block).toContain('toHaveAttribute(\'data-collapsed\', \'false\')')
    expect(block).toContain('window.scrollY')
  })
})

// issue #95 點名的兩種繞法之一。等「一段猜出來的秒數」在 preview 上必然偶發失敗，
// 而這兩條 test 等的是頁面自己給的訊號（data-animated 轉 true ＝ 還原已經處理完）
describe('新增的兩條 test 不靠 waitForTimeout 硬等', () => {
  it.each([POSITION_TEST, TOP_TEST])('「%s」沒有 waitForTimeout', (title) => {
    expect(blockOf(HOME_SPEC, title)).not.toContain('waitForTimeout')
  })
})

// 頁面把「還原已經處理完」暴露成 data-animated，E2E 才有東西可等。
// 這個屬性同時是 issue #55 的首幀旗標——兩者是同一件事的一體兩面
describe('data-animated 是頁面實際暴露的屬性', () => {
  it('首頁的 sticky 頁首上有 data-animated', () => {
    expect(read('app/pages/index.vue')).toContain(':data-animated="animated ? \'true\' : \'false\'"')
  })
})
