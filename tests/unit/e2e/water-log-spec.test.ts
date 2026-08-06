// @vitest-environment node
// 純文字比對，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// 記錄水質的 E2E（#124）在 preview 上跑第一輪時，「六項全空時擋下儲存」與
// 「非法讀值⋯⋯擋下儲存」兩條紅了：`toHaveCount(0)` 收到 5。
//
// 不是產品壞了，是測試自己的競態。`/log` 在 #84 之後是 SPA，歷史記錄要等 API 回來
// 才渲染，而 `locator.count()` 是一次性的快照、**不會自動等待**——`page.goto()` 之後
// 立刻取，量到的是還沒渲染的 0。接著 `click()` 會自動等到表單出現，那一刻歷史已經
// 到齊，於是「儲存前後筆數不變」變成拿 0 去對 5。
//
// 第一次的修法（等 `water-log-loading` 的筆數變成 0）沒有用，第二輪照樣紅：SPA 在
// `goto()` 回來時整個 app 都還沒 mount，載入樣態的筆數在「還沒開始載入」與「載入完了」
// 兩個時刻同樣都是 0，那個等待在 hydration 之前就先通過。**要等的是正面的訊號**，
// 也就是表單真的出現。
//
// 這支測試守的就是那件事：`count()` 之前必須先等到一個「只有載入完才成立」的條件。
// 只要有人再寫一次「goto 之後直接 count()」、或退回等待某個東西消失，這裡先紅，
// 而不是等 preview 上跑 8 分鐘才紅。斷言本身對不對仍由 preview 上的 E2E 收尾
// （與 logged-in-specs.test.ts 同樣的分工）。

const SPEC = 'tests/e2e/water-log.spec.ts'
const source = readFileSync(resolve(process.cwd(), SPEC), 'utf8')

/** 以 `test('…', …)` 為界切成一條一條，方便逐條看「在這條 test 裡的先後」 */
function testBlocks(text: string): string[] {
  return text.split(/^test\(/m).slice(1)
}

describe('water-log.spec.ts 的載入等待', () => {
  it('等的是表單出現，不是載入樣態消失', () => {
    // toBeVisible 只有在元素真的在畫面上時才成立，hydration 之前不會誤放行；
    // 反過來「等某個 testid 的筆數變成 0」在 SPA 上是個永遠先通過的假閘門
    expect(source).toContain('await expect(page.getByTestId(\'water-log-form\')).toBeVisible()')
    expect(source).not.toMatch(/getByTestId\('water-log-loading'\)\)\.toHaveCount\(0\)/)
  })

  it('每一處 count() 之前都先等畫面載入完成', () => {
    const blocks = testBlocks(source).filter(block => block.includes('.count()'))

    expect(blocks.length).toBeGreaterThan(0)

    for (const block of blocks) {
      const wait = block.indexOf('expectLoaded(page)')
      const count = block.indexOf('.count()')

      expect(wait).toBeGreaterThan(-1)
      expect(wait).toBeLessThan(count)
    }
  })

  it('「儲存前後筆數不變」比對的是實際數出來的筆數', () => {
    // 寫死的數字（例如退回 toHaveCount(0)）會把這條 test 的前提換掉：
    // 沙盒裡的示範資料本來就有幾筆歷史，0 只在載入還沒完成時才成立
    const blocked = testBlocks(source).filter(block => block.includes('擋下儲存'))

    expect(blocked).toHaveLength(2)

    for (const block of blocked) {
      expect(block).toContain('const before = await rows.count()')
      expect(block).toContain('toHaveCount(before)')
    }
  })
})
