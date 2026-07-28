import { describe, expect, it } from 'vitest'

// Given 我在行動裝置上瀏覽 / When 任一頁面渲染 / Then 全站套用深色主題
//
// 主色是跨畫面的全域 token（issue #8 的建議範圍列了「深色主題的全域 token」），
// 這裡把它釘在截圖量到的實際值上，之後各畫面的子 issue 才有共同基準。
//
// screen-1 的主色取樣結果（選中的「首頁」tab、「+ 新增」按鈕、水質數值）
// 三處都是 #2dd4bf ── 即 Tailwind teal-400，不是骨架預設的 cyan-400 #22d3ee。
describe('全域主題 token', () => {
  it('主色用截圖量到的 teal（#2dd4bf ＝ teal-400）', () => {
    const appConfig = useAppConfig()

    expect(appConfig.ui.colors.primary).toBe('teal')
  })

  it('中性色維持 slate，深色底才不會偏暖', () => {
    const appConfig = useAppConfig()

    expect(appConfig.ui.colors.neutral).toBe('slate')
  })
})
