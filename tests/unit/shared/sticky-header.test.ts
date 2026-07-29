import { describe, expect, it } from 'vitest'
import {
  HEADER_COLLAPSE_AT,
  HEADER_EXPAND_BELOW,
  shouldCollapseHeader,
} from '#shared/utils/stickyHeader'

// Given 我在首頁且生物卡片多到可以捲動 / When 我向下捲動 / Then 頁首收合為兩層
//
// 收合的判斷抽成純函式：門檻邏輯（含遲滯）不必開瀏覽器就能驗，
// 頁面層只負責把 window.scrollY 餵進來。
describe('shouldCollapseHeader', () => {
  it('尚未捲動時不收合', () => {
    expect(shouldCollapseHeader(0, false)).toBe(false)
  })

  it('捲動距離還沒到門檻時不收合', () => {
    expect(shouldCollapseHeader(HEADER_COLLAPSE_AT - 1, false)).toBe(false)
  })

  it('捲過門檻就收合', () => {
    expect(shouldCollapseHeader(HEADER_COLLAPSE_AT, false)).toBe(true)
    expect(shouldCollapseHeader(1200, false)).toBe(true)
  })

  // 收合會讓頁首變矮、文件跟著變短，捲動位置正好落在門檻上時單一門檻會來回抖動，
  // 所以展開的門檻比收合的低一截（遲滯）。
  it('已收合時只有回到更接近頂端才展開', () => {
    expect(shouldCollapseHeader(HEADER_COLLAPSE_AT - 1, true)).toBe(true)
    expect(shouldCollapseHeader(HEADER_EXPAND_BELOW + 1, true)).toBe(true)
    expect(shouldCollapseHeader(HEADER_EXPAND_BELOW, true)).toBe(false)
    expect(shouldCollapseHeader(0, true)).toBe(false)
  })

  it('展開的門檻低於收合的門檻', () => {
    expect(HEADER_EXPAND_BELOW).toBeLessThan(HEADER_COLLAPSE_AT)
  })

  // iOS 在頂端往下拉會給出負的 scrollY，那是「比頂端更上面」，不該收合
  it('橡皮筋回彈的負值視同在頂端', () => {
    expect(shouldCollapseHeader(-80, false)).toBe(false)
    expect(shouldCollapseHeader(-80, true)).toBe(false)
  })
})
