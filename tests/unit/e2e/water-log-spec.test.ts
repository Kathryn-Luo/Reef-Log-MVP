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
// 立刻取，量到的是還在載入樣態時的 0。接著 `click()` 會自動等到表單出現，那一刻歷史
// 已經到齊，於是「儲存前後筆數不變」變成拿載入中的 0 去對載入完的 5。
//
// 這支測試守的就是那個順序：只要有人再寫一次「goto 之後直接 count()」，這裡先紅，
// 而不是等 preview 上跑 8 分鐘才紅。斷言本身對不對仍由 preview 上的 E2E 收尾
// （與 logged-in-specs.test.ts 同樣的分工）。

const SPEC = 'tests/e2e/water-log.spec.ts'
const source = readFileSync(resolve(process.cwd(), SPEC), 'utf8')

/** 以 `test('…', …)` 為界切成一條一條，方便逐條看「在這條 test 裡的先後」 */
function testBlocks(text: string): string[] {
  return text.split(/^test\(/m).slice(1)
}

describe('water-log.spec.ts 的載入等待', () => {
  it('每一處 count() 之前都先等載入樣態消失', () => {
    const blocks = testBlocks(source).filter(block => block.includes('.count()'))

    expect(blocks.length).toBeGreaterThan(0)

    for (const block of blocks) {
      const wait = block.indexOf('water-log-loading')
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
