import type { MaintenanceRow, MaintenanceTaskDto } from '../types/maintenance'
import { isDateOnly } from './dateInput'

// 保養提醒（screen-7）的推算與 completedOn 的規則（issue #122）。
//
// 為什麼推算住在 shared 而不是 server：`nextDueOn`、「今天該做 vs 即將到期」、徽章數字
// 全部是推算值（schema.prisma 的 MaintenanceTask 註解已定案不存欄位），而它們都要問
// 一件 server 答不出來的事——**使用者的「今天」是哪一天**。server 跑在 UTC、使用者在
// UTC+8：台北時間 7/09 01:00 在 UTC 還是 7/08 17:00，server 自己算「今天」會差一整天，
// 而畫面正是靠這一天分「今天該做」與「即將到期」。
//
// 所以 `now` 由呼叫端傳入（與 formatRelativeTime(value, now)、parseWaterLogInput(raw, now)
// 同一個作法）：在瀏覽器裡取到的就是使用者自己的牆上時間，測試也不必動系統時鐘。
// 順帶的好處是勾選成功之後，畫面拿新的任務資料重跑一次同一支函式就好，
// 分區與徽章立刻正確，不必整頁重抓。

/**
 * 「即將到期」往後看幾天。
 *
 * 30 天是本專案自己定的（#15）。代價已經看得到：示範資料裡「換活性碳」每 60 天，
 * 12 天前做過 → 48 天後到期，在這個窗口下完全不會出現在畫面上。
 * 要不要加一個「更遠」的區塊由人類拍板（issue #122 第 7 節），先維持原始決定。
 */
export const UPCOMING_WINDOW_DAYS = 30

/**
 * completedOn 與 server 的今天最多能差幾天。
 *
 * 一天的餘裕是為了時區：使用者的「今天」與 server 的 UTC 今天最多差一天。
 * 超過就不是時區問題，是有人在改歷史——`MEASURED_AT_FUTURE_TOLERANCE_MS`（#128）
 * 是同一個思路。
 */
export const COMPLETED_ON_TOLERANCE_MS = 24 * 60 * 60 * 1000

/** 可以直接顯示給使用者的訊息。前端與 API 的 400 用的是同一句 */
export const INVALID_COMPLETED_ON_MESSAGE = '完成日期不正確。'
/** 訊息刻意與上面那句不同：格式錯與範圍錯是兩件事，講成同一句的話，
 * 補記前天的人只會回頭反覆檢查自己的日期格式（與 #128 同一個決定）。 */
export const COMPLETED_ON_OUT_OF_RANGE_MESSAGE = '只能勾選今天的保養。'

const DAY_MS = 24 * 60 * 60 * 1000

const pad = (value: number) => String(value).padStart(2, '0')

/** `YYYY-MM-DD` → 該日 UTC 零時的毫秒數。日期一律以 UTC 零時代表，加減天數才不會踩到日光節約 */
function dayStart(dateOnly: string): number {
  return Date.parse(`${dateOnly}T00:00:00.000Z`)
}

function toIsoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` + n 天。跨月、跨年、閏日的進位全部由 Date 負責，沒有第二份規則要維護 */
export function addDays(dateOnly: string, days: number): string {
  return toIsoDate(dayStart(dateOnly) + days * DAY_MS)
}

/**
 * 使用者當地的日曆日（`YYYY-MM-DD`）。
 *
 * 取的是牆上時間（`getFullYear` 這一組而不是 `getUTC*`），與
 * `defaultMeasuredAtInput`（shared/utils/waterLog.ts）同一個作法：畫面問的是
 * 「你的今天」，不是 UTC 的今天。這一個函式就是整份推算的時區立場所在。
 */
export function toLocalDateOnly(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * 下次到期日 ＝（最後完成日 ?? startOn ?? createdOn）+ intervalDays 天。
 *
 * 三層 fallback 來自 schema.prisma 的 `MaintenanceTask` 註解：尚無完成紀錄時以
 * `startOn` 起算，連 `startOn` 都沒有就視為建立當天起算。少了最後一層，
 * 「剛建好、還沒做過」的任務會算不出到期日。
 */
export function nextDueOn(task: MaintenanceTaskDto): string {
  return addDays(task.lastCompletion?.completedOn ?? task.startOn ?? task.createdOn, task.intervalDays)
}

function toRow(task: MaintenanceTaskDto, today: string): MaintenanceRow {
  const due = nextDueOn(task)
  const completedToday = task.lastCompletion?.completedOn === today

  return {
    task,
    nextDueOn: due,
    completedToday,
    overdue: due < today && !completedToday,
    dueInDays: Math.round((dayStart(due) - dayStart(today)) / DAY_MS),
  }
}

/**
 * 把任務分成畫面上的兩區，並算出標題旁的徽章數字。
 *
 * 分區規則（issue #122 第 4-3 節）：
 *   今天該做 ＝ nextDueOn 不晚於今天 **或** 今天已完成
 *   即將到期 ＝ 明天起 UPCOMING_WINDOW_DAYS 天內，依到期日由近到遠
 *   徽章     ＝ 今天該做之中今天尚未完成的數量
 *
 * ⚠「今天已完成」也留在今天該做區，這一條很容易做錯。#15 明文寫著「餵食」每天一次、
 * 今天已完成時仍顯示在今天該做區（已勾選、降透明度、不計入徽章）。但它今天做完之後
 * `nextDueOn` 已經是明天了——只照 `nextDueOn` 分區的話，這一列會在勾選的當下跳到
 * 「即將到期」去，等於畫面在懲罰使用者完成任務。
 *
 * 今天該做的順序：未完成的在前（依到期日由舊到新，逾期因此排最前面），已完成的殿後
 * 並維持送進來的順序（`displayOrder ASC, createdAt ASC`）。截圖上那三列
 * 「換水 10% → 折射計校正 → 餵食（已完成）」正是這個順序——「餵食」的 displayOrder
 * 比「折射計校正」小，它排到最後只可能是因為它已經完成了。
 */
export function buildMaintenanceSections(tasks: MaintenanceTaskDto[], now: Date): {
  today: MaintenanceRow[]
  upcoming: MaintenanceRow[]
  dueCount: number
} {
  const today = toLocalDateOnly(now)
  const rows = tasks.map(task => toRow(task, today))

  const dueToday = rows
    .filter(row => row.completedToday || row.nextDueOn <= today)
    // sort 是穩定的：兩列都已完成時比較結果為 0，它們之間因此維持原本的順序
    .sort((left, right) => Number(left.completedToday) - Number(right.completedToday)
      || (left.completedToday ? 0 : left.nextDueOn.localeCompare(right.nextDueOn)))

  const upcoming = rows
    .filter(row => !row.completedToday && row.nextDueOn > today && row.dueInDays <= UPCOMING_WINDOW_DAYS)
    .sort((left, right) => left.nextDueOn.localeCompare(right.nextDueOn))

  return {
    today: dueToday,
    upcoming,
    dueCount: dueToday.filter(row => !row.completedToday).length,
  }
}

/**
 * 網址那一段或 body 裡的 `completedOn`，收斂成可寫入的日期或一句可以直接顯示的錯誤。
 *
 * 合法性用既有的 `isDateOnly()`（shared/utils/dateInput.ts）：`2026-02-30` 交給 `Date`
 * 會自己滾成 3/2 而不是報錯，那一份判斷不該再寫第二遍。
 *
 * 範圍則以 server 的今天為準，容忍 ±1 天（見 COMPLETED_ON_TOLERANCE_MS）。
 * 這裡刻意用 UTC 的今天而不是當地：這一段是 server 端的驗證，而 server 跑在 UTC——
 * 使用者的「今天」由前端帶上來的 `completedOn` 表達，server 只負責確認它合不合理。
 *
 * 回傳該日 UTC 零時的 `Date`，那正是 Prisma 對 `@db.Date` 要的形狀。
 *
 * `now` 由呼叫端傳入，預設走真實時鐘（正式呼叫端是 server/utils/authorization.ts）。
 */
export function parseCompletedOn(value: unknown, now: Date = new Date()): { ok: true, value: Date } | { ok: false, message: string } {
  const text = typeof value === 'string' ? value.trim() : ''

  if (!isDateOnly(text)) {
    return { ok: false, message: INVALID_COMPLETED_ON_MESSAGE }
  }

  const completedOn = new Date(`${text}T00:00:00.000Z`)
  const serverToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())

  return Math.abs(completedOn.getTime() - serverToday) > COMPLETED_ON_TOLERANCE_MS
    ? { ok: false, message: COMPLETED_ON_OUT_OF_RANGE_MESSAGE }
    : { ok: true, value: completedOn }
}

/**
 * POST 的 body：`{ completedOn: 'YYYY-MM-DD' }`。規則與上面那支同一份。
 *
 * `completedAt` 刻意不由前端帶：它是「按下去的那個瞬間」，server 的 `now()` 就是同一個
 * 瞬間。前端只需要帶 `completedOn`（日曆日），因為只有那一個值需要使用者的時區。
 */
export function parseCompletedOnInput(raw: unknown, now: Date = new Date()): { ok: true, value: Date } | { ok: false, message: string } {
  const source = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}

  return parseCompletedOn(source.completedOn, now)
}
