/**
 * screen-1 水質摘要列的「· 4h」。
 *
 * schema.prisma 明確不存「更新於幾小時前」這種衍生值，一律由 measuredAt 推算，
 * 所以 now 由呼叫端傳入——元件才不必依賴真實時鐘，測試也不需要假時間。
 */
export function formatRelativeTime(value: string | Date, now: Date): string {
  const measured = value instanceof Date ? value : new Date(value)
  const minutes = Math.floor((now.getTime() - measured.getTime()) / 60_000)

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
