// 日期輸入（`<input type="date">` 交出來的 `YYYY-MM-DD`）的合法性判斷。
//
// 建立缸的開缸日期與生物詳情的發病日 / 死亡日都要問同一件事，所以放在共用的一支：
// 各自寫一份的話，兩邊對「2026-02-30」的看法遲早會不一樣。

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * 是不是一個「實際存在」的日期。
 *
 * 正規表達式過了還要再比對一次年月日，因為 `new Date('2026-02-30')` 會自己
 * 滾成 3/2 而不是報錯——格式對、日子不存在的輸入得在這裡擋下來。
 */
export function isDateOnly(text: string): boolean {
  const matched = ISO_DATE.exec(text)

  if (!matched) {
    return false
  }

  const [, year, month, day] = matched as unknown as [string, string, string, string]
  const date = new Date(`${text}T00:00:00.000Z`)

  return !Number.isNaN(date.getTime())
    && date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() + 1 === Number(month)
    && date.getUTCDate() === Number(day)
}
