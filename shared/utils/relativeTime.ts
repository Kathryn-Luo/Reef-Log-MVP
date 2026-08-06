/**
 * screen-1 水質摘要列的「· 4h」。
 *
 * schema.prisma 明確不存「更新於幾小時前」這種衍生值，一律由 measuredAt 推算，
 * 所以 now 由呼叫端傳入——元件才不必依賴真實時鐘，測試也不需要假時間。
 */
function minutesSince(value: string | Date, now: Date): number {
  const measured = value instanceof Date ? value : new Date(value)

  return Math.floor((now.getTime() - measured.getTime()) / 60_000)
}

export function formatRelativeTime(value: string | Date, now: Date): string {
  const minutes = minutesSince(value, now)

  if (minutes < 1) {
    return '剛剛'
  }

  if (minutes < 60) {
    return `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)

  if (hours < 24) {
    return `${hours}h`
  }

  return `${Math.floor(hours / 24)}d`
}

/**
 * screen-3 歷史記錄每一列右側的「4 天前」。
 *
 * 與 formatUpdatedAgo 的差別只有前綴：那一句在講「這份資料多新」，
 * 這一句貼在某一筆記錄旁邊，主詞已經在同一列的左邊了。
 */
export function formatTimeAgo(value: string | Date, now: Date): string {
  const minutes = minutesSince(value, now)

  if (minutes < 1) {
    return '剛剛'
  }

  if (minutes < 60) {
    return `${minutes} 分鐘前`
  }

  const hours = Math.floor(minutes / 60)

  if (hours < 24) {
    return `${hours} 小時前`
  }

  return `${Math.floor(hours / 24)} 天前`
}

/**
 * screen-2 數據儀表板副標的「更新於 4 小時前」。
 *
 * 摘要列的「4h」是給人一眼掃過的縮寫；儀表板一次只看一個缸、空間也夠，
 * 寫成完整的中文。未滿一分鐘時「更新於 剛剛前」不成話，改成完整的句子。
 */
export function formatUpdatedAgo(value: string | Date, now: Date): string {
  return minutesSince(value, now) < 1 ? '剛剛更新' : `更新於 ${formatTimeAgo(value, now)}`
}
