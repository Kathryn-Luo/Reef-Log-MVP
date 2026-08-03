// @vitest-environment node
// 純函式，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it } from 'vitest'
import {
  canRestoreTo,
  parseScrollMark,
  restoreTarget,
  scrollRestoreKey,
  serializeScrollMark,
} from '../../../shared/utils/scrollRestore'

// issue #103：SPA（#84）下瀏覽器的捲動位置還原永遠落空——`load` 當下文件只有一個
// viewport 高，沒有 991px 可以還原，等資料到齊、文件長到 1943px 時瀏覽器不會再回頭補。
// 還原的責任因此移到我們自己身上。這支測的是那件事不需要瀏覽器就驗得完的那一半：
// 存檔的 key 與格式、「這一筆存檔要不要還原」、「現在補得回去嗎」。

describe('捲動位置的存檔 key', () => {
  it('每個路由一份，彼此不會互相蓋掉', () => {
    expect(scrollRestoreKey('/')).not.toBe(scrollRestoreKey('/creatures'))
  })

  it('同一個路由每次算出來都一樣，重新整理後才找得回去', () => {
    expect(scrollRestoreKey('/')).toBe(scrollRestoreKey('/'))
  })
})

describe('存檔的讀寫', () => {
  it('寫出去再讀回來是同一筆', () => {
    const mark = { top: 991, document: 'doc-a' }

    expect(parseScrollMark(serializeScrollMark(mark))).toEqual(mark)
  })

  it('沒有存檔時是 null', () => {
    expect(parseScrollMark(null)).toBeNull()
  })

  // sessionStorage 是使用者改得動的地方，壞掉的內容不能讓頁面跟著壞
  it.each([
    ['不是 JSON', 'not-json'],
    ['不是物件', '42'],
    ['缺 top', '{"document":"doc-a"}'],
    ['top 不是數字', '{"top":"991","document":"doc-a"}'],
    ['top 是 NaN', '{"top":null,"document":"doc-a"}'],
    ['缺 document', '{"top":991}'],
  ])('%s 的存檔一律當作沒有', (_label, raw) => {
    expect(parseScrollMark(raw)).toBeNull()
  })
})

// Given 我在首頁向下捲動到頁首已經收合的位置 / When 我重新整理頁面
// Then 內容到齊之後，捲動位置回到重新整理前的位置
describe('要還原到哪裡', () => {
  it('上一份文件（重新整理前）存下的位置就是要補回去的位置', () => {
    expect(restoreTarget({ top: 991, document: 'doc-a' }, 'doc-b')).toBe(991)
  })

  // Given 我在首頁頂端（未捲動）/ When 我重新整理頁面
  // Then 畫面停在頂端，不會被還原到別的位置
  it('沒有存檔時不還原', () => {
    expect(restoreTarget(null, 'doc-b')).toBe(0)
  })

  it('存檔就在頂端時不還原', () => {
    expect(restoreTarget({ top: 0, document: 'doc-a' }, 'doc-b')).toBe(0)
  })

  // 這一份文件自己寫的存檔＝SPA 內部換頁留下的。那種換頁的捲動位置歸 router 管，
  // 我們只補「重新整理／再次開啟」跨文件的那一次——否則從別的 tab 回到首頁會被拉回舊位置
  it('同一份文件寫的存檔不還原', () => {
    expect(restoreTarget({ top: 991, document: 'doc-a' }, 'doc-a')).toBe(0)
  })
})

// 還原的時機是「內容到齊、文件高度足夠」之後，不是 onMounted 當下：
// 文件還只有一個 viewport 高時捲過去，只會被瀏覽器夾回頂端（正是這個 issue 的成因）
describe('現在補得回去嗎', () => {
  it('文件只有一個 viewport 高時補不回去', () => {
    expect(canRestoreTo(991, 844, 844)).toBe(false)
  })

  it('資料到齊、文件長到足夠時補得回去', () => {
    expect(canRestoreTo(991, 1943, 844)).toBe(true)
  })

  it('剛好夠到那個位置也算數', () => {
    expect(canRestoreTo(991, 1835, 844)).toBe(true)
  })
})
