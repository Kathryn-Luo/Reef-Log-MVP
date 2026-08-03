// @vitest-environment node
// 假的瀏覽器 + 假的 Page，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Page } from '@playwright/test'
import { HEADER_COLLAPSE_AT, shouldCollapseHeader } from '../../../shared/utils/stickyHeader'
import {
  HOME_CONTENT,
  scrollPastCollapse,
  scrollTo,
} from '../../e2e/support/scroll'

// issue #96：`home.spec.ts` 的 `scrollTo` 在任何環境下都會壞，成因有兩個——
//
//   ① 它拿「捲動前」算出來的目標值當判準。往下捲會讓 sticky 頁首收合、文件跟著變矮
//      約 108px，瀏覽器把 scrollY 夾回新的、比較小的最大值，於是那個目標值永遠等不到。
//   ② SPA（#84）下 `goto('/')` 之後資料還在路上，此時 `scrollHeight - innerHeight === 0`，
//      「捲到 0」立刻成立——helper 靜默地什麼都沒捲，後面的收合斷言自然拿到 false。
//
// 要驗的是 helper 自己的邏輯，不是瀏覽器。所以這裡把 helper 從 spec 裡拆出來
// （`tests/e2e/support/scroll.ts`），用一個「會收合、資料會晚到」的假瀏覽器驅動它：
// 兩個成因都能在 unit 這一層原地重現，不必等 Vercel preview 上的 E2E。
//
// 假瀏覽器刻意共用 `shouldCollapseHeader`——收合門檻與遲滯若哪天改了，這裡跟著改，
// 不會變成兩套各說各話的規則。

// ── 假的瀏覽器 ────────────────────────────────────────────────────────────

interface BrowserOptions {
  /** viewport 高（預設 390×844 的手機） */
  innerHeight?: number
  /** 內容到齊、頁首展開時的文件高 */
  contentHeight?: number
  /** 頁首收合讓文件矮掉多少（設計稿是 ~236px → ~92px） */
  collapseShrink?: number
  /** 首頁資料要等幾幀才到；在那之前文件與 viewport 同高，完全捲不動 */
  contentAfterFrames?: number
  /** 收合過場要幾幀播完（200ms ≈ 12 幀） */
  transitionFrames?: number
}

function createBrowser(options: BrowserOptions = {}) {
  const innerHeight = options.innerHeight ?? 844
  const contentHeight = options.contentHeight ?? 1835
  const collapseShrink = options.collapseShrink ?? 108
  const contentAfterFrames = options.contentAfterFrames ?? 0
  const transitionFrames = options.transitionFrames ?? 12

  const state = { frames: 0, scrollY: 0, collapsed: false, progress: 0 }

  const contentArrived = () => state.frames >= contentAfterFrames
  const scrollHeight = () =>
    contentArrived() ? contentHeight - collapseShrink * state.progress : innerHeight
  const maxScroll = () => Math.max(0, scrollHeight() - innerHeight)

  /** 推進一幀：收合往前播一格，文件因此變矮，捲動位置被夾回新的最大值 */
  function advance() {
    state.frames++
    state.collapsed = shouldCollapseHeader(state.scrollY, state.collapsed)

    const target = state.collapsed ? 1 : 0
    const step = 1 / transitionFrames
    state.progress = target > state.progress
      ? Math.min(target, state.progress + step)
      : Math.max(target, state.progress - step)

    // 這一行就是本 issue 的成因：捲動位置會在捲動之後自己往回跑
    state.scrollY = Math.min(state.scrollY, maxScroll())
  }

  const nextFrame = () =>
    new Promise<void>((resolve) => {
      setTimeout(() => {
        advance()
        resolve()
      }, 0)
    })

  return {
    state,
    contentArrived,
    nextFrame,
    install() {
      vi.stubGlobal('window', {
        get scrollY() {
          return state.scrollY
        },
        get innerHeight() {
          return innerHeight
        },
        scrollTo({ top }: { top: number }) {
          state.scrollY = Math.max(0, Math.min(top, maxScroll()))
        },
      })

      vi.stubGlobal('document', {
        documentElement: {
          get scrollHeight() {
            return scrollHeight()
          },
        },
      })

      vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => {
        setTimeout(() => {
          advance()
          callback(state.frames)
        }, 0)

        return state.frames
      })
    },
  }
}

/** 超過這麼多幀還等不到就當逾時——對應 Playwright 的 30s */
const TIMEOUT_FRAMES = 400

/**
 * 假的 Page。
 *
 * `evaluate` 直接在同一個 realm 呼叫傳進來的函式：那些函式在瀏覽器裡靠的是 `window` /
 * `document` / `requestAnimationFrame` 這些全域，這裡用 `vi.stubGlobal` 換成假瀏覽器，
 * 同一份程式碼就照樣跑得起來。
 *
 * 等待一律「先過一幀再檢查」：Playwright 的 `waitForFunction` 預設就是把判斷式排進
 * requestAnimationFrame，所以送出捲動與第一次檢查之間至少隔了一幀——收合正是在那一幀
 * 開始把文件變矮的。少了這一幀，舊 helper 會在收合還沒動之前就通過，bug 反而重現不了。
 */
function createPage(browser: ReturnType<typeof createBrowser>) {
  const waitedFor: string[] = []

  const page = {
    evaluate: async <A, R>(fn: (arg: A) => R | Promise<R>, arg: A) => fn(arg),

    waitForFunction: async <A>(fn: (arg: A) => unknown, arg: A) => {
      for (let frame = 0; frame < TIMEOUT_FRAMES; frame++) {
        await browser.nextFrame()
        if (await fn(arg)) return
      }

      throw new Error('page.waitForFunction: Timeout 30000ms exceeded.')
    },

    locator: (selector: string) => ({
      waitFor: async () => {
        waitedFor.push(selector)

        for (let frame = 0; frame < TIMEOUT_FRAMES; frame++) {
          if (browser.contentArrived()) return
          await browser.nextFrame()
        }

        throw new Error(`page.locator('${selector}').waitFor: Timeout 30000ms exceeded.`)
      },
    }),
  }

  return { page: page as unknown as Page, waitedFor }
}

function setup(options: BrowserOptions = {}) {
  const browser = createBrowser(options)
  browser.install()

  return { browser, ...createPage(browser) }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// 1835 - 844 = 991：收合「之前」算得出來的最大捲動量（舊 helper 拿去當判準的那個數字）
const MAX_BEFORE_COLLAPSE = 991
// 1835 - 108 - 844 = 883：收合「之後」真正停下來的位置
const MAX_AFTER_COLLAPSE = 883

// ── Given 首頁向下捲動會使 sticky 頁首收合、文件因此變矮約 108px ──────────
// When  測試呼叫 scrollTo 捲到接近頁面底部的位置
// Then  helper 在捲動位置穩定後回傳，不因為「收合後的落點小於捲動前算出的目標」而逾時
describe('收合把捲動位置往回夾', () => {
  it('scrollPastCollapse 等到捲動位置定下來才回傳，回傳的是收合後的實際落點', async () => {
    const { page, browser } = setup()

    const landed = await scrollPastCollapse(page)

    expect(landed).toBe(MAX_AFTER_COLLAPSE)
    expect(landed).toBeLessThan(MAX_BEFORE_COLLAPSE)
    // 回傳當下就是最終樣態：收合播完了，位置也不會再自己往回跑
    expect(browser.state.scrollY).toBe(landed)
    expect(browser.state.collapsed).toBe(true)
    expect(browser.state.progress).toBe(1)
  })

  it('scrollTo 的目標超過可捲空間時，回傳實際落點而不是捲動前算出的目標', async () => {
    const { page, browser } = setup()

    // 1200 正是原本寫死在 spec 裡、必定被夾到那個會變動的邊界上的數字
    const landed = await scrollTo(page, 1200)

    expect(landed).toBe(MAX_AFTER_COLLAPSE)
    expect(browser.state.scrollY).toBe(landed)
  })

  it('目標落在收合前後的最大捲動量「之間」時同樣不逾時', async () => {
    const { page } = setup()

    // 883 < 950 < 991：舊 helper 的判準恰好落在這個區間才會永遠等不到
    const landed = await scrollTo(page, 950)

    expect(landed).toBe(MAX_AFTER_COLLAPSE)
  })

  it('捲得回頂端，頁首跟著展開', async () => {
    const { page, browser } = setup()

    await scrollPastCollapse(page)
    const landed = await scrollTo(page, 0)

    expect(landed).toBe(0)
    expect(browser.state.collapsed).toBe(false)
    expect(browser.state.progress).toBe(0)
  })
})

// ── Given SPA（#84）下 page.goto('/') 之後首頁資料還要數秒才到 ─────────────
// When  測試在資料到達前呼叫 scrollTo
// Then  helper 等到內容出現才計算捲動量，不會因為當下頁面不可捲而靜默地捲了個 0
describe('資料還在路上就被呼叫', () => {
  it('scrollPastCollapse 等到內容出現才捲，落點超過收合門檻', async () => {
    const { page, browser, waitedFor } = setup({ contentAfterFrames: 20 })

    const landed = await scrollPastCollapse(page)

    expect(waitedFor).toContain(HOME_CONTENT)
    expect(landed).toBe(MAX_AFTER_COLLAPSE)
    expect(landed).toBeGreaterThan(HEADER_COLLAPSE_AT)
    expect(browser.state.collapsed).toBe(true)
  })

  it('scrollTo 同樣等到內容出現，不會靜默地捲了個 0', async () => {
    const { page, browser, waitedFor } = setup({ contentAfterFrames: 20 })

    const landed = await scrollTo(page, 600)

    expect(waitedFor).toContain(HOME_CONTENT)
    expect(landed).toBe(600)
    expect(browser.state.scrollY).toBe(600)
  })

  it('內容一直沒出現時明確逾時，不是回報一個沒捲到的位置', async () => {
    const { page, browser } = setup({ contentAfterFrames: Number.POSITIVE_INFINITY })

    await expect(scrollPastCollapse(page)).rejects.toThrow(/Timeout/)
    expect(browser.state.scrollY).toBe(0)
  })

  it('內容出現了但頁面捲不動時明確逾時，不是靜默地捲了個 0', async () => {
    // 沒有生物的缸：內容到齊了，可捲空間仍是 0
    const { page, browser } = setup({ contentHeight: 844 })

    await expect(scrollPastCollapse(page)).rejects.toThrow(/Timeout/)
    expect(browser.state.scrollY).toBe(0)
  })
})

// ── Given 上述兩點都修好 ────────────────────────────────────────────────────
// When  執行 home.spec.ts 的「sticky 頁首」與「數據儀表板」
// Then  9 條原本因 scrollTo 而失敗的 test 依各自的斷言判定成敗
//
// 「依各自的斷言判定成敗」只有在 Vercel preview 上真的跑 E2E 才驗得到（這個 job 沒有
// 瀏覽器、也沒有資料庫）。這裡守的是它的前提，比照 guest-login-spec.test.ts 的分工：
// 那 9 條都還在、都不再走舊的那條路、也沒有人為了讓它綠而把 test 刪掉或跳過。
describe('home.spec.ts 的 9 條 test 不再卡在 helper 上', () => {
  const HOME_SPEC = 'tests/e2e/home.spec.ts'

  const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

  /** 把一支 spec 切成「一個 test 一段」（切在每一行開頭的 `test(` / `test.describe(` 之前） */
  const testBlocks = (source: string) => source.split(/\n(?=[ \t]*test(?:\.\w+)?\()/)

  function blockOf(file: string, title: string): string {
    const block = testBlocks(read(file)).find(candidate => candidate.includes(title))

    expect(block, `${file} 找不到「${title}」這條 test`).toBeDefined()

    return block!
  }

  /** issue 列出的 9 條：4 條因 helper 逾時，5 條因為捲動當下資料還沒到 */
  const AFFECTED = [
    '向下捲動後頁首收合，固定區高度明顯縮小',
    '向下捲動後頁首與水質列留在畫面上，標題列與 chip 列捲離畫面',
    '底部 tab 列不受固定頁首影響',
    '捲回頂端後版面回到初始樣態',
    '展開時同樣有過場，方向與收合對稱',
    '收合狀態下切換缸的選單完整顯示在卡片之上',
    '還原到已捲動的位置時，首幀直接是收合樣態、不補播收合動畫',
    '頁首收合狀態下點摘要列一樣展開儀表板',
    '過場進行中底部 tab 列不移動，生物卡片不回彈',
  ]

  it.each(AFFECTED)('「%s」不再拿寫死的 1200 當捲動目標', (title) => {
    expect(blockOf(HOME_SPEC, title)).not.toMatch(/\b1200\b/)
  })

  it.each(AFFECTED)('「%s」改用會等內容到齊的 helper 到達收合狀態', (title) => {
    expect(blockOf(HOME_SPEC, title)).toMatch(/scrollPastCollapse\(|sampleDuringCollapse\(/)
  })

  it('spec 不再自己定義 scrollTo，改用共用的 helper', () => {
    const source = read(HOME_SPEC)

    expect(source).not.toMatch(/function scrollTo\b/)
    expect(source).toMatch(/from '\.\/support\/scroll'/)
  })

  it('spec 裡不再有「拿捲動前算出的值去等 scrollY」的寫法', () => {
    expect(read(HOME_SPEC)).not.toContain('waitForFunction')
  })

  it('逐幀取樣的 sampleDuringCollapse 也先等內容到齊才取樣', () => {
    const source = read(HOME_SPEC)
    const helper = source.slice(source.indexOf('async function sampleDuringCollapse'))

    expect(helper).toMatch(/waitForScrollableHome\(page\)/)
  })

  // 條數是「不准變少」的錨點：#96 當時是 34 條，issue #102 加了一條
  //（展開時缸副標仍是單行省略、與缸名之間的間距不變）→ 35，
  // issue #103 為捲動位置還原再加兩條（重新整理後回到原位、在頂端重新整理停在頂端）→ 37。
  // 加 test 時把這個數字一起加上去；變少則要先問為什麼。
  it('37 條 test 都還在，沒有被刪掉或跳過', () => {
    const source = read(HOME_SPEC)

    expect(source.match(/^\s*test\(/gm) ?? []).toHaveLength(37)
    expect(source).not.toContain('test.only')
    // 既有的那一條 `test.skip` 是條件式跳過（Chromium 以外沒有 CDP），不是本次新增的
    expect(source.match(/test\.skip/g) ?? []).toHaveLength(1)
  })

})
