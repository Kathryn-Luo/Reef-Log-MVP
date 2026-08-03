// @vitest-environment node
// 純文字比對 + 讀設定值，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it } from 'vitest'
import playwrightConfig from '../../../playwright.config'
import { blockOf, read } from '../support/spec-source'

// issue #95：E2E 跑在 Vercel preview URL 上（冷啟 + Neon），沿用 Playwright 的預設 timeout
// 必然爆掉。實測 5 次「按下訪客登入 → 首頁真的有資料」要 13.7～21.1 秒，而預設的 test /
// hook timeout 是 30 秒——一條 test 裡只要開兩位訪客就一定超時。
//
// 這支測試守的是「修法有沒有走偏」，不是「E2E 會不會過」（那要 preview 才驗得到）。
// 特別要擋的是 issue 點名的兩種繞法：把斷言改鬆、用 `waitForTimeout` 硬等。

/** issue 實測 5 次的觀測上限：「登入完 → 首頁有資料」最慢的一次 */
const SLOWEST_GUEST_LOGIN_MS = 21_100

/** issue 的修法方向給的量級：有餘裕，又不會讓真的壞掉的 case 拖太久 */
const REQUIRED_TEST_TIMEOUT_MS = 90_000

/** Playwright 的預設值——沿用它就是這個 issue 的成因 */
const PLAYWRIGHT_DEFAULT_TEST_TIMEOUT_MS = 30_000
const PLAYWRIGHT_DEFAULT_EXPECT_TIMEOUT_MS = 5_000

const AUTHZ_SPEC = 'tests/e2e/api-authorization.spec.ts'
const GUEST_SPEC = 'tests/e2e/guest-login.spec.ts'
const DETAIL_SPEC = 'tests/e2e/creature-detail.spec.ts'
const CREATURE_LIST_PAGE = 'app/pages/creatures/index.vue'

/** 一段程式碼裡 `test.setTimeout(...)` 指定的毫秒數（沒有就是 undefined） */
function setTimeoutMs(source: string): number | undefined {
  const match = source.match(/test\.setTimeout\(\s*([\d_]+)\s*\)/)

  return match ? Number(match[1]!.replaceAll('_', '')) : undefined
}

// ── Then：beforeAll 跑得完，三條 test 依各自的斷言判定成敗，不再以 hook timeout 結束 ──

describe('playwright.config.ts 的 timeout 反映 preview 的實況', () => {
  // 這是所有「timeout 類」失敗的共同成因：30 秒是本機的量級，不是 preview 的量級。
  it('test timeout 不再是 Playwright 的 30 秒預設', () => {
    expect(playwrightConfig.timeout).toBeDefined()
    expect(playwrightConfig.timeout).toBeGreaterThan(PLAYWRIGHT_DEFAULT_TEST_TIMEOUT_MS)
  })

  it('test timeout 容得下 preview 上一次訪客登入的觀測上限，還留得下操作的餘裕', () => {
    expect(playwrightConfig.timeout).toBeGreaterThanOrEqual(REQUIRED_TEST_TIMEOUT_MS)
  })
})

describe('api-authorization.spec.ts 的 beforeAll 要開兩位訪客', () => {
  const beforeAll = () => {
    const hook = read(AUTHZ_SPEC).match(/test\.beforeAll\(async[\s\S]*?\n {2}\}\)/)

    expect(hook, `${AUTHZ_SPEC} 找不到 test.beforeAll`).not.toBeNull()

    return hook![0]
  }

  // hook timeout 預設等於 test timeout。全域拉到 90 秒之後這個 hook 已經不會再爆，
  // 但它做的是別人兩倍的事（兩位訪客各自登入 + 兩支 API），所以自己再加碼一次。
  it('beforeAll 自己再用 test.setTimeout() 加碼', () => {
    expect(setTimeoutMs(beforeAll())).toBeDefined()
  })

  it('加碼的量級容得下「依序開兩位訪客」', () => {
    expect(setTimeoutMs(beforeAll())).toBeGreaterThanOrEqual(2 * SLOWEST_GUEST_LOGIN_MS)
    // 而且要真的比全域大——與全域同值等於沒加碼
    expect(setTimeoutMs(beforeAll())).toBeGreaterThan(playwrightConfig.timeout!)
  })

  // 最省事的「修法」是讓 beforeAll 少開一位訪客，hook 自然就跑得完了——
  // 但那三條 test 驗的正是「A 拿不到 B 的東西」，少了 B 就什麼都不剩。
  it('beforeAll 仍然依序開兩位訪客，並確認兩人的缸不同', () => {
    const hook = beforeAll()

    expect(hook.match(/openSandbox\(browser\)/g) ?? []).toHaveLength(2)
    expect(hook).toContain('expect(a.tankId).not.toBe(b.tankId)')
  })

  // 「不再以 hook timeout 結束」的另一種假達成：把 test 拿掉就不會有 test 逾時了。
  it('issue 點名的三條 test 都還在，沒有被刪掉或跳過', () => {
    const source = read(AUTHZ_SPEC)

    for (const title of [
      'A 打 B 的 tankId /home 得到 404，回應裡沒有 B 的資料',
      'A 改不動 B 的生物，B 那一隻一個欄位都沒變',
      '不存在的 id 與 B 的 id 得到同一個狀態碼',
    ]) {
      expect(source, `${AUTHZ_SPEC} 少了「${title}」`).toContain(title)
    }

    expect(source).not.toContain('test.skip')
    expect(source).not.toContain('test.only')
  })
})

// ── Then：兩次訪客登入都跑得完，測試依斷言判定成敗 ──

describe('guest-login.spec.ts —「下一位訪客拿到的仍是乾淨的示範資料」', () => {
  const TITLE = '訪客改動自己的沙盒之後，下一位訪客拿到的仍是乾淨的示範資料'

  // 這條 test 一定要開兩位訪客（A 弄髒自己的沙盒、C 之後才進站），
  // 所以它可用的 timeout 至少要是「一次訪客登入」觀測上限的兩倍。
  it('這條 test 可用的 timeout 容得下兩次訪客登入', () => {
    const block = blockOf(GUEST_SPEC, TITLE)
    const effective = setTimeoutMs(block) ?? playwrightConfig.timeout!

    expect(effective).toBeGreaterThanOrEqual(2 * SLOWEST_GUEST_LOGIN_MS)
  })

  it('它仍然真的開了兩位訪客', () => {
    const block = blockOf(GUEST_SPEC, TITLE)

    expect(block.match(/browser\.newContext\(\)/g) ?? []).toHaveLength(2)
    expect(block.match(/login-action-guest/g) ?? []).toHaveLength(2)
  })
})

// ── Then：openCreature 等到詳情頁自己的內容出現才回傳，後續斷言不會命中列表頁的元素 ──

describe('creature-detail.spec.ts 的 openCreature 等的是畫面，不只是 URL', () => {
  const openCreature = () => {
    const helper = read(DETAIL_SPEC).match(/async function openCreature[\s\S]*?\n\}/)

    expect(helper, `${DETAIL_SPEC} 找不到 openCreature`).not.toBeNull()

    return helper![0]
  }

  // #84 關掉 SSR 之後 URL 換得比畫面早：`toHaveURL` 通過時畫面可能還停在列表上，
  // 這時 getByTestId('creature-name') 會同時命中列表的 5 個列，撞上 strict mode。
  it('toHaveURL 之後還等一個詳情頁自己的元素', () => {
    const helper = openCreature()
    const urlAssertion = helper.indexOf('toHaveURL')

    expect(urlAssertion, 'openCreature 仍該確認 URL 換好了').toBeGreaterThan(-1)
    // 畫面證據要排在 URL 之後：URL 都還沒換的時候等畫面，等到的可能是上一頁的殘影
    expect(helper.indexOf('creature-taxonomy')).toBeGreaterThan(urlAssertion)
  })

  // 「等一個詳情頁自己的元素」的前提是它真的只有詳情頁有。
  // 挑到一個列表頁也有的 testid 的話，這一句在列表上就會通過，等於沒等。
  it('等的那個元素在列表頁上不存在', () => {
    expect(read(CREATURE_LIST_PAGE)).not.toContain('creature-taxonomy')
  })

  // 詳情頁的 useAsyncData 要走一趟 preview 的 API（issue 實測 +1.5～3 秒）。
  // 這一句等的是網路，不是渲染，5 秒的預設 expect timeout 餘裕太薄。
  it('expect 的等待預算容得下詳情頁自己去要一次資料', () => {
    expect(playwrightConfig.expect?.timeout).toBeDefined()
    expect(playwrightConfig.expect!.timeout).toBeGreaterThan(PLAYWRIGHT_DEFAULT_EXPECT_TIMEOUT_MS)
  })
})

// ── issue 明令不准的兩種繞法 ──

describe('沒有用繞過的方式讓 E2E 變綠', () => {
  // `waitForTimeout` 在慢的時候一樣會爆、在快的時候白白浪費時間。
  it.each([AUTHZ_SPEC, GUEST_SPEC, DETAIL_SPEC])('%s：沒有用 waitForTimeout 硬等', (spec) => {
    expect(read(spec)).not.toContain('waitForTimeout')
  })

  // 「等到詳情頁出現」不該順手把後面的斷言改成 `.first()` 之類的閃避寫法——
  // strict mode 命中 5 個元素是「還沒換頁」的證據，把它避開就看不見了。
  it('詳情頁的俗名斷言仍然是嚴格的單一元素比對', () => {
    expect(blockOf(DETAIL_SPEC, '詳情頁顯示俗名、學名、分類標籤，頁首有返回與編輯'))
      .toContain('await expect(page.getByTestId(\'creature-name\')).toHaveText(\'六線龍\')')
  })
})
