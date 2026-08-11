// @vitest-environment node
// 純文字比對，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it } from 'vitest'
import { read, testBlocks } from '../support/spec-source'
import { PROTECTED_PAGES } from '../../e2e/support/protectedPages'

// issue #146：auth-guard.spec.ts 的「已登入開 <path> 停在原地」原本只驗網址與
// 「登入頁的標記不存在」，而後者在 app 還沒 mount 的那一拍同樣成立，所以某一頁
// 整頁壞掉時那組 test 照樣是綠的。完整的成因寫在 tests/e2e/support/protectedPages.ts。
//
// 這支測試守的是修法本身：那一組 test 要先等到「這一頁自己載入成功才會有」的正面標記，
// 而且那句等待要排在 `toHaveCount(0)` 之前。等到之後畫面對不對仍由 Vercel preview 上的
// `pnpm test:e2e` 收尾——與 logged-in-specs.test.ts、water-log-spec.test.ts 同樣的分工。
//
// 「壞掉時真的會紅」那一半在 tests/unit/pages/protected-page-markers.test.ts：
// 這裡證明 spec 等的是正面標記，那裡證明那些標記在該頁 500 時真的不存在。

const SPEC = 'tests/e2e/auth-guard.spec.ts'
const source = read(SPEC)

/**
 * 「已登入開 <path> 停在原地」那一條。
 *
 * 它是一個 for 迴圈裡的單一 `test()`（路徑由 PROTECTED_PAGES 帶進來），
 * 所以原始碼裡只有一段，不是六段。
 */
function loggedInBlock(): string {
  const block = testBlocks(source).find(candidate =>
    /^[ \t]+test\(/.test(candidate) && candidate.includes('已登入開 ${path} 停在原地'),
  )

  expect(block, `${SPEC} 找不到「已登入開 …」那一條 test`).toBeDefined()

  return block!
}

/**
 * 去掉註解再看。
 *
 * 底下幾題比對的是「誰排在誰前面」，而說明這件事的註解本身就會提到
 * `toHaveCount(0)`——不去掉的話，量到的是註解的位置，不是那句斷言的位置。
 *
 * 區塊註解一定要一起處理，不能只濾掉 `//` 開頭的行。少了那一句的話，
 * 把整段斷言用區塊註解包起來之後，底下每一題都還是綠的——切得出剛好一行、
 * 形狀對、順序也算得出來——而 E2E 那一組已經完全退回 #146 的原狀。
 * 這不是假想的攻擊：偶發紅的時候先註解掉看看是不是它，然後那個「先」變成永久。
 */
const withoutComments = (block: string) =>
  block
    // 先整段拿掉區塊註解，再逐行濾單行註解
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')

/**
 * 「等 marker 出現」那一句斷言本身。
 *
 * 為什麼要精準切到一行，而不是在整段裡用一個「marker 後面幾十個字元內要有
 * toBeVisible」的視窗去比對：那種寫法擋不住中間插進來的否定。
 * `.first()).not.toBeVisible()` 只有 14 個字元，任何合理的視窗都容得下它，
 * 於是「等這一頁的標記**消失**」——正是 #129 禁止、而且 SPA 還沒 mount 時恆真的
 * 那個寫法——會從守門前面大搖大擺走過去。
 *
 * 切到單獨一行之後就沒有視窗可鑽了：整句話都在眼前，否定藏不住。
 * 順帶也擋掉「多加一句等 marker」的情況——只准有一句，不然順序那題會失去意義。
 */
function markerAssertion(): string {
  const lines = withoutComments(loggedInBlock())
    .split('\n')
    .filter(line => line.includes('getByTestId(marker)'))

  expect(lines, `${SPEC} 裡等 marker 的斷言不是剛好一句`).toHaveLength(1)

  // 那一句必須是單獨一句 await expect(…)，不能被任何東西包起來。
  //
  // 少了這一句的話，守門看的只是「這一行長得對不對」，管不到它會不會執行：
  //
  //   if (path === '/') await expect(page.getByTestId(marker).first()).toBeVisible()
  //
  // 切得出剛好一行、形狀也對，於是全綠——而六頁裡有五頁的正面標記在 E2E 上
  // 等於不存在。這正是為了單獨重跑某一頁而臨時加上、然後忘了拿掉的樣子。
  // 同一句話也擋掉 `x && await expect(…)`、賦值與 return 包裝。
  //
  // ⚠ 守門到此為止：把 if 拆成兩行就繞得過去。那已經是刻意規避，不是無心之過，
  // 而正則寫不出「這一句真的會執行」的證明——再疊下去只是把洞縮小，不是補起來。
  expect(lines[0]!.trim(), `${SPEC} 等 marker 的那一句不是單獨一句 await expect(…)`)
    .toMatch(/^await expect\(/)

  return lines[0]!
}

describe('每一個受保護的頁面都指名了自己的正面標記', () => {
  // issue 的清單加上 #16 新增的 /creatures/new
  it('七頁都在表上', () => {
    expect(PROTECTED_PAGES.map(page => page.path))
      .toEqual(['/', '/log', '/trends', '/creatures', '/creatures/new', '/maintenance', '/tanks/new'])
  })

  // ⚠ 底下兩題只是命名上的早期警示，**不是**「標記合格」的證明。
  //
  // 一個是關鍵字、一個是兩個字串的黑名單，兩者都繞得過去：`water-log-subtitle`
  // 同樣是三態共用的常駐頁首卻不在黑名單上，`sandbox-preparing`（#144）名字裡
  // 也沒有 loading。真正逐頁把關的是 tests/unit/pages/protected-page-markers.test.ts
  // ——它把該頁的 API 全部打成 500，看那個標記在不在，繞不過去。
  //
  // 留著是因為它們便宜且訊息直白：踩到已知的兩個坑時，錯誤會指名道姓，
  // 而不是丟一句「500 時標記還在」讓人回頭找原因。

  // 載入樣態在「還沒開始畫」與「已經畫完」時都不在畫面上，
  // 拿它當條件與 toHaveCount(0) 是同一個毛病（#129）
  it.each(PROTECTED_PAGES)('$path 的標記名稱裡沒有 loading', ({ marker }) => {
    expect(marker).not.toMatch(/loading/)
  })

  // /trends 與 /maintenance 的副標是三態共用的常駐頁首：整頁壞掉時它還在，
  // 拿它當正面標記等於沒驗到。這兩個名字因此不准出現在表上。
  it.each(PROTECTED_PAGES)('$path 的標記不是已知的那兩個常駐頁首', ({ marker }) => {
    expect(['trends-subtitle', 'maintenance-subtitle']).not.toContain(marker)
  })
})

// Given 我已登入
// When  我開啟 / /log /trends /creatures /maintenance /tanks/new 其中任一頁
// Then  該頁自己的正面標記出現
describe('已登入的那一組先等正面標記', () => {
  it('迴圈跑的是共用的那張表，沒有自己另抄一份路徑清單', () => {
    expect(source).toContain('./support/protectedPages')
    // 迴圈的標頭落在 test() 之外，所以這一句看的是整份原始碼
    expect(source).toMatch(/for\s*\(const\s*\{[^}]*marker[^}]*\}\s*of\s*PROTECTED_PAGES\)/)
  })

  it('等的是該頁自己的標記出現', () => {
    // toBeVisible 只有在元素真的在畫面上時才成立，hydration 之前不會誤放行
    expect(markerAssertion()).toMatch(/getByTestId\(marker\)(?:\.first\(\))?\)\s*\.toBeVisible\(\)/)
  })

  // 這一題是上一題的另一半，不能省。「等 marker 出現」與「等 marker 消失」都會提到
  // marker，光看有沒有 toBeVisible 分不出來——`.not.toBeVisible()` 兩者皆備。
  // 而「等某個東西消失」在 app 還沒 mount 時恆成立，正是 #146 要修掉的那個毛病。
  it('不是等某個東西消失', () => {
    expect(markerAssertion())
      .not.toMatch(/\.not\.|toBeHidden|toBeDetached|toHaveCount\(\s*0\s*\)/)
  })

  // 順序是重點：「登入頁的標記不存在」要排在正面訊號之後才有意義，
  // 排在前面的話它仍然可能在「還沒開始畫」的那一拍就先通過。
  it('toHaveCount(0) 排在正面標記之後', () => {
    const block = withoutComments(loggedInBlock())
    const positive = block.indexOf('getByTestId(marker)')
    const absence = block.indexOf('toHaveCount(0)')

    expect(positive).toBeGreaterThan(-1)
    expect(absence).toBeGreaterThan(-1)
    expect(positive).toBeLessThan(absence)
  })
})

// And 我沒有被導去登入頁
describe('原本驗到的兩件事都還在', () => {
  it('仍然驗網址與「沒被導去登入頁」', () => {
    const block = loggedInBlock()

    expect(block).toContain('toHaveURL')
    expect(block).toContain('getByTestId(\'login-screen\')')
  })
})

// 非目標：不處理未登入那一半（`/login` 會出現，那本來就是正面訊號）。
// 這一組守的是它沒有被順手改掉。
describe('未登入那一半沒有被動到', () => {
  // 六頁不必逐一驗：未登入的清單是從 PROTECTED_PAGES 直接展開的，漏不掉。
  // 要盯的是那個展開沒有被拆回手抄的清單，以及只出現在這裡的 /creatures/:id
  // ——它沒有「登入後畫得出來」的標記可以指名，所以進不了那張表。
  it('未登入的清單直接沿用共用的那張表，另外多一條 /creatures/:id', () => {
    // 只認「有沒有展開」，不管參數叫什麼、有沒有型別註記、eslint 怎麼換行——
    // 要防的是「拆回手抄清單」，把格式綁死只會在無關的改寫上假紅
    expect(source).toMatch(/\.\.\.PROTECTED_PAGES\.map\(/)
    expect(source).toContain('/creatures/not-a-real-id')
  })

  it('未登入開受保護的頁面仍然等登入頁自己出現', () => {
    expect(source).toContain('await expect(page.getByTestId(\'login-screen\')).toBeVisible()')
  })

  it('「未登入開首頁看不到任何資料」那一條還在', () => {
    expect(source).toContain('未登入開首頁時，畫面上沒有任何缸或生物的資料')
  })
})

// 這一輪只加強斷言，不該有 test 消失
describe('沒有 test 被刪掉或跳過', () => {
  it('至少還有原本那 6 個 test() 呼叫', () => {
    // 迴圈算一個。原本是：未登入迴圈、未登入看不到資料、登入頁開得起來、
    // 已登入迴圈、已登入重新整理、已登入開 /login
    expect((source.match(/^[ \t]*test\(/gm) ?? []).length).toBeGreaterThanOrEqual(6)
  })

  it('沒有被宣告成 skip / fixme / only 的 test', () => {
    expect(source).not.toMatch(/test(?:\.describe)?\.skip\(\s*(['"`]|async)/)
    // fixme 是 Playwright 版的 skip，跳過的效果一樣（skip 那條擋不到它）
    expect(source).not.toMatch(/test(?:\.describe)?\.fixme\(/)
    expect(source).not.toContain('test.only')
    expect(source).not.toContain('test.describe.only')
  })
})
