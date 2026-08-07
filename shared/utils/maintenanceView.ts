import type { MaintenanceRow } from '../types/maintenance'

// 保養提醒（screen-7，issue #125）畫面上「算得出來的字串」。
//
// 為什麼與 shared/utils/maintenance.ts 分開兩支：那一支是 #122 的推算契約，API 與畫面
// 共用（分區、徽章、nextDueOn、completedOn 的驗證）；這一支只有畫面用得到——它把一列
// 排版成三段字，換一個版型就會跟著改，不該混進 server 也依賴的那一份。
//
// 這裡不做任何日期推算：「逾期 3 天」是 -dueInDays、「3 天後」是 dueInDays、
// 到期日方塊讀的是 nextDueOn。四個值都由 buildMaintenanceSections 算好了，
// 畫面再減一次日期只會多出第二份規則，而且遲早與第一份不一致。

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

const pad = (value: number) => String(value).padStart(2, '0')

/**
 * 頁首副標的「7 月 8 日 週二」。
 *
 * 取的是使用者當地的今天（`getMonth` 這一組而不是 `getUTC*`），與
 * `toLocalDateOnly()` 同一個時區立場：整頁的分區靠那一天，副標寫的必須是同一天。
 */
export function formatMaintenanceDate(now: Date): string {
  return `${now.getMonth() + 1} 月 ${now.getDate()} 日 週${WEEKDAY_LABELS[now.getDay()]}`
}

/** 「每天」／「每 7 天」。截圖上每天一次的那一列寫的是「每天」，不是「每 1 天」 */
export function formatIntervalText(intervalDays: number): string {
  return intervalDays === 1 ? '每天' : `每 ${intervalDays} 天`
}

/** `YYYY-MM-DD` → 「07/01」。字串切片而不是 `new Date()`：它本來就是當地的日曆日，
 * 交給 Date 解析反而會在 UTC+8 的午夜前後被推回前一天 */
const monthDay = (dateOnly: string) => `${dateOnly.slice(5, 7)}/${dateOnly.slice(8, 10)}`

export interface MaintenanceTodayRowView {
  id: string
  name: string
  /** 「每 7 天 · 上次 07/01」／「每天 · 已完成 08:20」／從未做過時只有「每 7 天」 */
  subtitle: string
  /** 右側狀態：「今天」／「逾期 3 天」。今天已完成時為空字串 */
  statusText: string
  completedToday: boolean
  overdue: boolean
}

export interface MaintenanceUpcomingRowView {
  id: string
  name: string
  /** 這一區的副標只有週期：左側方塊講的已經是「下次」，再寫「上次」只會擠掉名稱 */
  subtitle: string
  /** 到期日方塊的日，補零成兩位數（截圖上 8/05 那一列寫的是「05」） */
  dayText: string
  /** 到期日方塊的月，例：「7月」 */
  monthText: string
  /** 「3 天後」 */
  dueText: string
}

function todaySubtitle(row: MaintenanceRow): string {
  const interval = formatIntervalText(row.task.intervalDays)
  const last = row.task.lastCompletion

  // 從未做過的任務沒有「上次」可寫。用「上次 —」佔位的話，「還沒做過」與
  // 「做過但沒有紀錄」會長得一模一樣（與 /log 的「上次」同一個決定）
  if (!last) {
    return interval
  }

  if (row.completedToday) {
    const completedAt = new Date(last.completedAt)

    // 「08:20」是當地的牆上時間：completedAt 存的是 UTC 的那個瞬間，
    // 而使用者問的是「我今天早上幾點餵的」
    return `${interval} · 已完成 ${pad(completedAt.getHours())}:${pad(completedAt.getMinutes())}`
  }

  return `${interval} · 上次 ${monthDay(last.completedOn)}`
}

/**
 * 「今天該做」的每一列。
 *
 * 已完成的列右側不再給狀態字：同一列的 checkbox 與副標的「已完成 08:20」已經把話說完，
 * 再補一個「今天」只是重複（截圖上那一列右側也是空的）。
 */
export function buildTodayRowViews(rows: MaintenanceRow[]): MaintenanceTodayRowView[] {
  return rows.map(row => ({
    id: row.task.id,
    name: row.task.name,
    subtitle: todaySubtitle(row),
    // 逾期天數寫成文字而不是只把字變紅：只靠顏色的話色覺障礙者讀不到
    statusText: row.completedToday ? '' : row.overdue ? `逾期 ${-row.dueInDays} 天` : '今天',
    completedToday: row.completedToday,
    overdue: row.overdue,
  }))
}

/** 「即將到期」的每一列。順序由 buildMaintenanceSections 排好（由近到遠），這裡不重排 */
export function buildUpcomingRowViews(rows: MaintenanceRow[]): MaintenanceUpcomingRowView[] {
  return rows.map(row => ({
    id: row.task.id,
    name: row.task.name,
    subtitle: formatIntervalText(row.task.intervalDays),
    dayText: row.nextDueOn.slice(8, 10),
    monthText: `${Number(row.nextDueOn.slice(5, 7))}月`,
    dueText: `${row.dueInDays} 天後`,
  }))
}
