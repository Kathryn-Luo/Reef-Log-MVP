// screen-2 數據儀表板每一列中間的迷你趨勢線。
//
// 折線只是一串座標，與 SVG 無關，所以獨立成純函式：元件負責畫 <polyline>，
// 這裡負責把「一串讀數」映射到「一個小方框裡的折線」。
// 沒有時間軸——刻意讓每個點等距，因為量測間隔本來就不規律，
// 照實拉開時距會讓「最近測得比較密」的那一段擠成一團，看不出走勢。

export const SPARKLINE_WIDTH = 96
export const SPARKLINE_HEIGHT = 28

/** 線本身有厚度，最高與最低點貼著邊會被裁掉半條，所以上下各留一點 */
export const SPARKLINE_PADDING = 2

/** 座標保留兩位小數就夠精細，DOM 上也才不會塞一長串浮點數 */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 把讀數序列（由舊到新）換成 `<polyline points>` 用的字串。
 * 少於兩筆讀數畫不出「走勢」，回傳空字串讓呼叫端決定不要渲染。
 */
export function sparklinePoints(
  values: number[],
  width = SPARKLINE_WIDTH,
  height = SPARKLINE_HEIGHT,
): string {
  if (values.length < 2) {
    return ''
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min

  const stepX = width / (values.length - 1)
  const top = SPARKLINE_PADDING
  const bottom = height - SPARKLINE_PADDING

  return values
    .map((value, index) => {
      // 全部一樣高時沒有「相對高低」可言，畫成置中的水平線
      const y = span === 0
        ? height / 2
        // SVG 的 y 軸向下，數值大的要落在小的 y
        : bottom - ((value - min) / span) * (bottom - top)

      return `${round(index * stepX)},${round(y)}`
    })
    .join(' ')
}
