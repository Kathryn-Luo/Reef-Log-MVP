import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h, nextTick } from 'vue'
import {
  SCROLL_RESTORE_MAX_FRAMES,
  useScrollRestore,
} from '../../../app/composables/useScrollRestore'
import { signedInUserSession } from '../support/session'
import { parseScrollMark, scrollRestoreKey, serializeScrollMark } from '#shared/utils/scrollRestore'

// 路由保護是全域 middleware：沒有身分的話 mountSuspended 那次導覽會被帶去 /login，
// 存檔的 key 也就跟著變成別的路由（見 tests/unit/support/session.ts）
mockNuxtImport('useUserSession', () => () => signedInUserSession())

// issue #103：捲動位置的還原從瀏覽器手上接過來。
//
// 這支測的是接手之後的時序——瀏覽器做不到的正是時序：它在 `load` 當下還原，
// 而那一刻 SPA 的文件只有一個 viewport 高。所以這裡每一題都圍繞著
// 「文件什麼時候才夠高」，而不是「捲到哪一個 px」。
//
// requestAnimationFrame 換成手動推進：等待的長度本來就是這個機制的重點，
// 交給真實時鐘的話，「還沒到齊時不要動」會變成一條靠 sleep 賭運氣的斷言。

const FRAME_BUDGET = SCROLL_RESTORE_MAX_FRAMES + 2

let frames: FrameRequestCallback[] = []
let scrollTo: ReturnType<typeof vi.fn>

const Probe = defineComponent({
  setup() {
    const { settled } = useScrollRestore()

    return () => h('div', { 'data-settled': settled.value ? 'true' : 'false' })
  },
})

/** 推進 n 幀：每一幀把目前排隊的 callback 全部執行掉 */
async function runFrames(count = 1) {
  for (let index = 0; index < count; index++) {
    const pending = frames

    frames = []

    for (const callback of pending) {
      callback(index)
    }

    await nextTick()
  }
}

/** 模擬瀏覽器：捲動位置改變，並送出 scroll 事件 */
function scroll(top: number) {
  Object.defineProperty(window, 'scrollY', { value: top, configurable: true })
  window.dispatchEvent(new Event('scroll'))
}

/** 內容到齊、文件長到這麼高 */
function setDocumentHeight(height: number) {
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    value: height,
    configurable: true,
  })
}

/** 上一份文件（重新整理前）留下的存檔 */
function markFromPreviousDocument(path: string, top: number) {
  window.sessionStorage.setItem(
    scrollRestoreKey(path),
    serializeScrollMark({ top, document: 'previous-document' }),
  )
}

function settledOf(probe: Awaited<ReturnType<typeof mountSuspended>>) {
  return probe.get('div').attributes('data-settled')
}

/** 目前存下的那一筆 */
function storedMark(path: string) {
  return parseScrollMark(window.sessionStorage.getItem(scrollRestoreKey(path)))
}

beforeEach(() => {
  frames = []
  scrollTo = vi.fn()

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)

    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('scrollTo', scrollTo)

  window.sessionStorage.clear()
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true })

  // 進站當下：SPA 的資料還在路上，文件只有一個 viewport 高
  setDocumentHeight(844)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// Given 我在首頁向下捲動到頁首已經收合的位置 / When 我重新整理頁面
// Then 內容到齊之後，捲動位置回到重新整理前的位置
describe('內容到齊之後把捲動位置補回去', () => {
  it('文件還只有一個 viewport 高時按兵不動', async () => {
    markFromPreviousDocument('/', 991)

    const probe = await mountSuspended(Probe, { route: '/' })

    await runFrames(30)

    // 這時候捲過去只會被夾回頂端——瀏覽器就是這樣失手的
    expect(scrollTo).not.toHaveBeenCalled()
    expect(settledOf(probe)).toBe('false')
  })

  it('文件長到足夠之後才捲回原本的位置', async () => {
    markFromPreviousDocument('/', 991)

    const probe = await mountSuspended(Probe, { route: '/' })

    await runFrames(30)
    setDocumentHeight(1943)
    await runFrames(2)

    expect(scrollTo).toHaveBeenCalledWith({ top: 991, behavior: 'instant' })
    expect(settledOf(probe)).toBe('true')
  })

  it('補回去之後不再重覆捲動', async () => {
    markFromPreviousDocument('/', 991)

    await mountSuspended(Probe, { route: '/' })

    setDocumentHeight(1943)
    await runFrames(10)

    expect(scrollTo).toHaveBeenCalledTimes(1)
  })

  // 等不到就放棄：頁面不能因為內容永遠不夠長而卡在「還沒還原」，
  // 那會讓等著 settled 的頁首永遠不開放過場
  it('等不到內容到齊就放棄，停在頂端', async () => {
    markFromPreviousDocument('/', 991)

    const probe = await mountSuspended(Probe, { route: '/' })

    await runFrames(FRAME_BUDGET)

    expect(scrollTo).not.toHaveBeenCalled()
    expect(settledOf(probe)).toBe('true')
  })

  // 慢的時候還沒到齊、快的時候閃一下，所以判準是文件高度而不是固定的等待長度
  it('等待期間使用者自己捲動就放棄，不把人拉回去', async () => {
    markFromPreviousDocument('/', 991)

    const probe = await mountSuspended(Probe, { route: '/' })

    await runFrames(5)
    scroll(120)
    setDocumentHeight(1943)
    await runFrames(5)

    expect(scrollTo).not.toHaveBeenCalled()
    expect(settledOf(probe)).toBe('true')
  })
})

// Given 我在首頁頂端（未捲動）/ When 我重新整理頁面
// Then 畫面停在頂端，不會被還原到別的位置
describe('沒有東西要還原時什麼都不做', () => {
  it('沒有存檔時不捲動，而且立刻就緒', async () => {
    const probe = await mountSuspended(Probe, { route: '/' })

    setDocumentHeight(1943)
    await runFrames(5)

    expect(scrollTo).not.toHaveBeenCalled()
    expect(settledOf(probe)).toBe('true')
  })

  it('上一份文件停在頂端時不捲動', async () => {
    markFromPreviousDocument('/', 0)

    const probe = await mountSuspended(Probe, { route: '/' })

    setDocumentHeight(1943)
    await runFrames(5)

    expect(scrollTo).not.toHaveBeenCalled()
    expect(settledOf(probe)).toBe('true')
  })

  it('別的路由存下的位置不會被套到這一頁', async () => {
    markFromPreviousDocument('/creatures', 991)

    await mountSuspended(Probe, { route: '/' })

    setDocumentHeight(1943)
    await runFrames(5)

    expect(scrollTo).not.toHaveBeenCalled()
  })
})

describe('存檔本身', () => {
  it('捲動時把目前的位置記下來，下一次重新整理才有位置可補', async () => {
    await mountSuspended(Probe, { route: '/' })

    scroll(991)

    expect(window.sessionStorage.getItem(scrollRestoreKey('/'))).toContain('991')
  })

  // SPA 內部換頁（同一份文件）留下的存檔不該被當成「重新整理前的位置」：
  // 從別的 tab 回到首頁時，捲動位置歸 router 管
  it('同一份文件內再次掛載不會還原自己剛存下的位置', async () => {
    const first = await mountSuspended(Probe, { route: '/' })

    scroll(991)
    first.unmount()

    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    setDocumentHeight(1943)

    await mountSuspended(Probe, { route: '/' })
    await runFrames(5)

    expect(scrollTo).not.toHaveBeenCalled()
  })

  // 存檔在「還原處理完」的當下一律重設成現在的位置。
  //
  // 不重設的話會留下一筆「舊文件寫的、位置不是 0」的存檔：這一次因為同文件或因為
  // 放棄而沒有用到它，下一次重新整理卻會把它當成「重新整理前的位置」補回去，
  // 把停在頂端的人拉走（PR #105 的 review）。
  it('同文件返回頂端後，舊位置不會留到下一次重新整理', async () => {
    const first = await mountSuspended(Probe, { route: '/' })

    scroll(991)
    first.unmount()

    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    setDocumentHeight(1943)

    // 從別的 tab 換回首頁：同一份文件，所以不還原——但存檔要跟著回到頂端
    await mountSuspended(Probe, { route: '/' })
    await runFrames(5)

    expect(storedMark('/')?.top).toBe(0)
  })

  it('等不到內容而放棄之後，舊位置不會留到下一次重新整理', async () => {
    markFromPreviousDocument('/', 991)

    await mountSuspended(Probe, { route: '/' })
    await runFrames(FRAME_BUDGET)

    // 放棄＝停在頂端，那就是這一份文件現在的位置；留著 991 的話下一次會被它拉走
    expect(storedMark('/')?.top).toBe(0)
    expect(storedMark('/')?.document).not.toBe('previous-document')
  })

  // 隱私模式下 sessionStorage 會直接丟例外。還原是加分功能，不值得讓整頁壞掉
  it('sessionStorage 不能用時頁面照常運作', async () => {
    vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    const probe = await mountSuspended(Probe, { route: '/' })

    scroll(991)
    await runFrames(5)

    expect(settledOf(probe)).toBe('true')
  })
})
