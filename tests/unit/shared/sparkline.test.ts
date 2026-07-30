import { describe, expect, it } from 'vitest'
import {
  SPARKLINE_HEIGHT,
  SPARKLINE_PADDING,
  SPARKLINE_WIDTH,
  sparklinePoints,
} from '#shared/utils/sparkline'

// screen-2 每一列中間的迷你趨勢線。折線是純粹的座標運算，
// 與 SVG 無關，所以獨立成函式——元件只負責把 points 塞進 <polyline>。

const TOP = SPARKLINE_PADDING
const BOTTOM = SPARKLINE_HEIGHT - SPARKLINE_PADDING
const MIDDLE = SPARKLINE_HEIGHT / 2

/** 把 "x,y x,y" 拆回數對，斷言才不必跟字串格式綁死 */
function parse(points: string): number[][] {
  return points
    .split(' ')
    .filter(Boolean)
    .map(pair => pair.split(',').map(Number))
}

describe('sparklinePoints', () => {
  // Then 每列顯示……迷你趨勢線
  it('把數列平均分佈在寬度上，最舊在左、最新在右', () => {
    const points = parse(sparklinePoints([1, 2, 3]))

    expect(points.map(([x]) => x)).toEqual([0, SPARKLINE_WIDTH / 2, SPARKLINE_WIDTH])
  })

  // SVG 的 y 軸向下，數值大的要畫在上面
  it('數值越大 y 越小（值高的畫在上方）', () => {
    const points = parse(sparklinePoints([1, 2, 3]))

    expect(points.map(([, y]) => y)).toEqual([BOTTOM, MIDDLE, TOP])
  })

  it('走勢下滑時折線由高往低（對應 Mg 一路降到偏低）', () => {
    const ys = parse(sparklinePoints([1300, 1260, 1180])).map(([, y]) => y)

    expect(ys[0]).toBeLessThan(ys[1]!)
    expect(ys[1]).toBeLessThan(ys[2]!)
  })

  // 線寬有厚度，貼著上下邊會被裁掉半條
  it('最高與最低點都留出邊距，不貼著上下緣', () => {
    const ys = parse(sparklinePoints([1, 5])).map(([, y]) => y)

    expect(Math.min(...ys)).toBe(SPARKLINE_PADDING)
    expect(Math.max(...ys)).toBe(SPARKLINE_HEIGHT - SPARKLINE_PADDING)
  })

  it('數值全都相同時畫成置中的水平線', () => {
    const points = parse(sparklinePoints([5, 5, 5]))

    expect(points.map(([, y]) => y)).toEqual([MIDDLE, MIDDLE, MIDDLE])
  })

  // 只有一筆讀數畫不出「走勢」，交給呼叫端決定不要渲染
  it('少於兩筆讀數時回傳空字串', () => {
    expect(sparklinePoints([])).toBe('')
    expect(sparklinePoints([7.8])).toBe('')
  })

  it('可指定尺寸', () => {
    const points = parse(sparklinePoints([1, 2], 10, 10))

    expect(points.map(([x]) => x)).toEqual([0, 10])
    expect(points.map(([, y]) => y)).toEqual([10 - SPARKLINE_PADDING, SPARKLINE_PADDING])
  })
})
