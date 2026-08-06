import type { WaterParameterKey, WaterReadingDto } from '../types/home'
import type { CreateWaterLogInput, PreviousReadingDto, WaterLogDto, WaterLogRequest } from '../types/waterLog'
import {
  WATER_PARAMETER_FULL_LABELS,
  WATER_PARAMETER_LABELS,
  WATER_PARAMETER_ORDER,
  WATER_PARAMETER_UNITS,
  formatReadingValue,
} from './waterQuality'
import { isDateOnly } from './dateInput'
import { formatTimeAgo } from './relativeTime'

// 水質記錄的欄位規則與畫面推算（screen-3；資料 API 是 #121 / PR #127，畫面是 #124）。
//
// 兩件事放在同一支，與 shared/utils/creatureDetail.ts 同一個作法：
//   1. 欄位規則。`parseWaterLogInput` 原本住在 server/utils/waterLog.ts，
//      這一輪搬過來讓表單與 API 共用同一份——同一組限制寫兩次的話，
//      遲早會有一邊先漂走（issue #124 第 3 節允許的唯一一次搬移，行為未變）。
//      server 那側直接從這裡 import，不在 server/utils/waterLog.ts 再匯出一次——
//      同一個名字同時出現在兩份 auto-import 名單上，Nuxt 會印「Duplicated imports」
//      並靜靜地挑一邊（理由寫在 server/utils/waterLog.ts 的檔頭）。
//   2. 畫面上「算得出來的東西」——日期＋時間怎麼合成 measuredAt、「上次 8.0」、
//      歷史每一列的「07 / 04 · 21:00」與「4 天前」。schema.prisma 一律不存這些衍生值。

/**
 * 讀值的上限，來自 schema.prisma 的 `WaterReading.value @db.Decimal(10, 4)`：
 * 整數部分最多 6 位、小數 4 位。超過的話 Prisma 會在寫入時才丟錯，
 * 那時使用者已經按下儲存、也已經走完一次往返——擋在解析這一步比較誠實。
 *
 * ⚠ 這個常數與下面的 `WATER_READING_DECIMALS`（合起來就是 `READING_PATTERN`）
 * **是讀值精度保證的唯一來源**，見下方 EXACT_ROUND_TRIP_DIGITS。
 */
export const MAX_WATER_READING = 999999.9999

/** 讀值最多幾位小數。同樣來自 `Decimal(10, 4)`，也是精度保證的另一半 */
export const WATER_READING_DECIMALS = 4

/**
 * IEEE 754 double 能「原值進、原值出」的十進位有效位數。
 *
 * 為什麼要把它寫下來：讀值在這裡是 `Number()` 成 JS number 放進 DTO，寫入時才交給
 * Prisma 的 `Decimal(10, 4)`。目前不會失真，但**安全來自解析規則，不是來自浮點數本身**
 * ——`MAX_WATER_READING` 的 6 位整數加上 `WATER_READING_DECIMALS` 的 4 位小數，
 * 最長也只有 10 位有效數字，遠在這條線之內，所以 double 的最短往返表示法轉回字串
 * 一定拿得回原值。
 *
 * 哪天有人放寬小數位數、或把上限往上調到讓有效位數超過這條線，這條路就會開始掉尾數。
 * 那種失真不會讓任何既有斷言變紅（值仍然是個合法的數字，只是不是使用者打的那個），
 * 所以 tests/unit/server/water-log.test.ts 用這三個常數釘住了「規則的位數 ≤ 這條線」。
 * 真的需要更高精度時，改法是讓讀值以字串一路傳到 Prisma（`Decimal` 收字串），
 * 而不是把規則放寬了事。
 */
export const EXACT_ROUND_TRIP_DIGITS = 15

/** 讀值的形狀：非負、最多 WATER_READING_DECIMALS 位小數。負號與指數寫法都不在裡面 */
const READING_PATTERN = new RegExp(`^\\d+(?:\\.\\d{1,${WATER_READING_DECIMALS}})?$`)

/**
 * 量測時間的下限（含）：2000-01-01T00:00:00Z。
 *
 * 刻意不用缸的 `startedOn` 當下限（issue #128 的方向 B）：新缸還沒開就先配水試測是
 * 真實情境，拿開缸日當界線會誤傷。這條線只負責擋「年份打錯」那一類離譜的輸入。
 */
export const MEASURED_AT_EARLIEST_MS = Date.UTC(2000, 0, 1)

/**
 * 量測時間的上限（含）：現在 + 1 天。
 *
 * 沒有選「不得晚於現在」（issue #128 的方向 A）：手機時鐘快個幾分鐘就會讓「剛量完就
 * 記錄」被拒，而那是這支 API 最常見的用法，容差要拿捏反而是新的爭議。
 *
 * 這一輪要防的是輸入錯誤，不是防弊——把 2026 打成 2199 的那一筆會因為歷史依
 * `measuredAt desc` 排序而永遠置頂，也會把趨勢圖（#12）的 X 軸整個拉開。
 * 一天的餘裕擋得掉所有打錯年份的情況，又完全碰不到正常使用。
 */
export const MEASURED_AT_FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000

/** 可以直接顯示給使用者的訊息。前端的欄位錯誤與 API 的 400 用的是同一句 */
export const INVALID_READING_MESSAGE = '讀值必須是介於 0 和 999999.9999 的數字，且最多四位小數。'
export const NON_NUMERIC_READING_MESSAGE = '讀值必須是大於或等於零的數字。'
export const EMPTY_READINGS_MESSAGE = '至少填寫一項讀值。'
export const INVALID_MEASURED_AT_MESSAGE = '量測日期或時間不正確。'
/** 訊息刻意與 INVALID_MEASURED_AT_MESSAGE 不同：格式錯與範圍錯是兩件事，
 * 講成同一句的話，年份打錯的人只會回頭反覆檢查自己的日期格式。 */
export const MEASURED_AT_OUT_OF_RANGE_MESSAGE = '量測時間不合理：不能早於 2000 年，也不能比現在晚超過一天。'

/** 這裡是精度保證本身，不只是「擋掉奇怪的輸入」——理由見 EXACT_ROUND_TRIP_DIGITS */
function isValidReading(normalized: string, value: number): boolean {
  return READING_PATTERN.test(normalized) && Number.isFinite(value) && value <= MAX_WATER_READING
}

/**
 * 一格讀值的規則，給表單在失焦時用（驗收條件：「欄位失焦時顯示該欄的驗證錯誤」）。
 *
 * 留空回 null：六項全都可以不填，「這次沒量」不是錯誤。只打空白也算留空——
 * 表單送出時會把它一起濾掉，server 因此不會收到一格空白。
 */
export function readingFieldError(text: string): string | null {
  const normalized = text.trim()

  if (!normalized) {
    return null
  }

  return isValidReading(normalized, Number(normalized)) ? null : INVALID_READING_MESSAGE
}

/**
 * 把送進來的 body 收斂成可寫入的內容，或給出一句可以直接顯示的錯誤。
 *
 * `measuredAt` 一定要帶 offset（`+08:00` 或 `Z`）：畫面上的日期與時間是使用者當地的
 * 牆上時間，而 `WaterLog.measuredAt` 存的是量測的那個瞬間。少了 offset 就只能猜他在
 * 哪個時區，猜錯的那幾筆在趨勢圖上會整條偏移。
 *
 * 日期的合法性用「回推 ISO 日期再比對」判斷，而不是逐月天數表：`2026-02-31` 交給
 * `Date` 會滾成 3/3，把它 format 回 `YYYY-MM-DD` 與原字串一比就露餡了。閏年、大小月
 * 全部由 `Date` 自己負責，沒有第二份規則要維護。
 *
 * 格式對了還要看**範圍**（#128）：合法的 ISO 字串裡有 `2199-01-01`，收下它就會有一筆
 * 永遠置頂的記錄。上下限的理由分別寫在 MEASURED_AT_FUTURE_TOLERANCE_MS 與
 * MEASURED_AT_EARLIEST_MS 上。
 *
 * `now` 由呼叫端傳入而不是在函式內部讀時鐘（與 shared/utils/creatureDetail.ts 的
 * `daysInTank(creature, now)` 同一個作法）：邊界值因此測得到，測試也不必動系統時鐘。
 * 正式呼叫端（server/utils/authorization.ts 的 createOwnedWaterLog）走預設值。
 */
export function parseWaterLogInput(raw: unknown, now: Date = new Date()): { ok: true, value: CreateWaterLogInput } | { ok: false, message: string } {
  const source = typeof raw === 'object' && raw !== null ? raw as Partial<WaterLogRequest> : {}
  const measuredAtSource = typeof source.measuredAt === 'string' ? source.measuredAt : ''
  const date = measuredAtSource.slice(0, 10)
  const measuredAt = new Date(measuredAtSource)
  const calendarDate = new Date(`${date}T00:00:00.000Z`)

  // 時分秒各自再檢查一次：`Date` 對 `24:00:00` 是寬容的（滾到隔天零時），
  // 但那不是使用者在時間欄裡輸入得出來的東西，收下它只會讓資料多一種形狀。
  const timestamp = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(measuredAtSource)
  if (!timestamp
    || Number.isNaN(measuredAt.getTime())
    || calendarDate.toISOString().slice(0, 10) !== date
    || Number(timestamp[2]) > 23
    || Number(timestamp[3]) > 59
    || Number(timestamp[4]) > 59) {
    return { ok: false, message: INVALID_MEASURED_AT_MESSAGE }
  }

  if (measuredAt.getTime() > now.getTime() + MEASURED_AT_FUTURE_TOLERANCE_MS
    || measuredAt.getTime() < MEASURED_AT_EARLIEST_MS) {
    return { ok: false, message: MEASURED_AT_OUT_OF_RANGE_MESSAGE }
  }

  const submitted = source.readings && typeof source.readings === 'object' ? source.readings : {}
  const readings: WaterReadingDto[] = []
  for (const parameter of WATER_PARAMETER_ORDER) {
    const rawValue = submitted[parameter]
    if (rawValue === null || rawValue === undefined || rawValue === '') continue
    if (typeof rawValue !== 'number' && typeof rawValue !== 'string') {
      return { ok: false, message: NON_NUMERIC_READING_MESSAGE }
    }
    const normalized = typeof rawValue === 'string' ? rawValue.trim() : String(rawValue)
    if (!isValidReading(normalized, Number(normalized))) {
      return { ok: false, message: INVALID_READING_MESSAGE }
    }
    readings.push({ parameter, value: Number(normalized) })
  }

  return readings.length
    ? { ok: true, value: { measuredAt, readings } }
    : { ok: false, message: EMPTY_READINGS_MESSAGE }
}

// ─────────────────────────────────────────────
// screen-3 的表單
// ─────────────────────────────────────────────

const pad = (value: number) => String(value).padStart(2, '0')

/** `<input type="time">` 交出來的 `HH:mm`（部分瀏覽器會多帶秒數） */
const TIME_INPUT = /^(\d{2}):(\d{2})(?::\d{2})?$/

/**
 * 日期欄與時間欄的預設值：今天、現在。
 *
 * 取的是當地的牆上時間（`getFullYear` 這一組而不是 `getUTC*`）——
 * 畫面上問的是「你是幾點測的」，不是 UTC 的幾點。
 */
export function defaultMeasuredAtInput(now: Date): { date: string, time: string } {
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  }
}

/**
 * 日期欄 + 時間欄 → 帶著 UTC offset 的 `measuredAt`。組不出來時回 null。
 *
 * 兩欄的內容是當地時間，先交給 `Date` 解析（不帶 offset 的字串一律以當地時間解讀），
 * 再 `toISOString()` 換成那個瞬間的 UTC 表示。把 `YYYY-MM-DDTHH:mm` 直接送出去的話
 * server 會回 400——它沒辦法知道那是哪個時區的 21:30。
 */
export function composeMeasuredAt(date: string, time: string): string | null {
  const matched = TIME_INPUT.exec(time)

  if (!isDateOnly(date) || !matched) {
    return null
  }

  const [, hours, minutes] = matched as unknown as [string, string, string]

  // `Date` 對 24:00 是寬容的（滾到隔天零時），與 parseWaterLogInput 一樣不收
  if (Number(hours) > 23 || Number(minutes) > 59) {
    return null
  }

  const measuredAt = new Date(`${date}T${hours}:${minutes}:00`)

  return Number.isNaN(measuredAt.getTime()) ? null : measuredAt.toISOString()
}

export interface WaterReadingFieldView {
  parameter: WaterParameterKey
  label: string
  unit: string
  /** 該測項從未被記錄過時為 null——那一欄右側因此只有單位，沒有「上次」 */
  previousDisplay: string | null
}

/**
 * 六個讀值欄。順序、標籤與單位都取自 shared/utils/waterQuality.ts 的同一份定義。
 *
 * `previousReadings` 少了某個測項就代表「該缸該測項從未被記錄過」（見
 * shared/types/waterLog.ts）。這裡不補 0、也不補「—」當作值：那會讓「還沒量過」
 * 與「量過但這次沒填」看起來一樣。
 */
export function buildReadingFields(previousReadings: WaterReadingDto[]): WaterReadingFieldView[] {
  return WATER_PARAMETER_ORDER.map((parameter) => {
    const previous = previousReadings.find(reading => reading.parameter === parameter)

    return {
      parameter,
      label: WATER_PARAMETER_FULL_LABELS[parameter],
      unit: WATER_PARAMETER_UNITS[parameter],
      previousDisplay: previous ? formatReadingValue(parameter, previous.value) : null,
    }
  })
}

/**
 * 剛存下的那一筆成為下一次的「上次」。
 *
 * 這次沒填的測項維持原本的前次讀值——它們的「最近一筆已存在的讀值」沒有改變。
 * 不重抓一次 API 是同一個理由：POST 已經回傳了剛寫進去的內容（issue #124 第 3 節）。
 *
 * 「有填就覆蓋」則不夠（issue #131）：日期與時間欄可以自由填，補記上週的量測是這一頁
 * 明確支援的用法，無條件覆蓋會讓那一欄的「上次」被較舊的讀值蓋掉。驗收條件要的是
 * 該測項**最近一筆已存在**的讀值（#11 / #124），server 的 `getPreviousReadings` 也是
 * 照 `measuredAt desc` 取第一筆，所以這裡覆蓋前先比一次時間。
 *
 * 比得準的前提是 `previousReadings` 自己帶著 `measuredAt`（`PreviousReadingDto`）。
 * 早先的版本從 `waterLogs` 反推前次讀值的時間，查不到就退回「歷史最舊的那一刻」——
 * 歷史有筆數上限，某個測項的前次讀值落在截斷之外時那個退路會判錯：看得到的歷史從
 * 1/1 開始、KH 最後一筆在去年 12/1，補記 12/15 的 KH 會被當成更舊的而不予覆蓋。
 *
 * 「不早於」而不是「晚於」：同一刻的兩筆，後寫進去的那筆在 server 那側同樣會排到前面
 * ——`getPreviousReadings` 與歷史查詢都以 `createdAt` 當次要排序鍵，這是明確的保證，
 * 不是「大概不會撞在一起」。時間欄是分鐘精度，同一分鐘內連存兩筆做得到。
 *
 * 從未量過的測項沒有可比的對象，補記的那一筆就是它最近一筆已存在的讀值，照樣顯示。
 */
export function mergePreviousReadings(
  previousReadings: PreviousReadingDto[],
  created: WaterLogDto,
): PreviousReadingDto[] {
  const createdAt = new Date(created.measuredAt).getTime()

  return WATER_PARAMETER_ORDER.flatMap((parameter) => {
    const previous = previousReadings.find(candidate => candidate.parameter === parameter)
    const fresh = created.readings.find(candidate => candidate.parameter === parameter)

    if (fresh && (!previous || createdAt >= new Date(previous.measuredAt).getTime())) {
      return [{ parameter, value: fresh.value, measuredAt: created.measuredAt }]
    }

    return previous ? [{ parameter, value: previous.value, measuredAt: previous.measuredAt }] : []
  })
}

// ─────────────────────────────────────────────
// screen-3 的歷史記錄
// ─────────────────────────────────────────────

/**
 * 歷史每一列摘要哪幾項。六項全列在 390px 下塞不下，截圖也只挑這三項。
 * 順序即顯示順序。
 */
const SUMMARY_PARAMETERS: readonly WaterParameterKey[] = ['KH', 'CA', 'MG']

export interface WaterLogRow {
  id: string
  /** 「07 / 04 · 21:00」，量測當下的當地時間 */
  timeText: string
  /** 「KH 8.0 · Ca 415 · Mg 1240」 */
  summaryText: string
  /** 「4 天前」。由 measuredAt 推算，不存欄位 */
  agoText: string
}

function orderReadings(readings: WaterReadingDto[]): WaterReadingDto[] {
  return WATER_PARAMETER_ORDER.flatMap(parameter =>
    readings.filter(reading => reading.parameter === parameter))
}

function summarize(readings: WaterReadingDto[]): string {
  const picked = SUMMARY_PARAMETERS.flatMap(parameter =>
    readings.filter(reading => reading.parameter === parameter))

  // KH / Ca / Mg 一項都沒填也是這一頁允許的用法（「只測了 PO₄」）。硬取那三項的話
  // 這一列會只剩時間，看起來像壞掉的空列，所以退而列出這次真的有填的前三項。
  const shown = picked.length ? picked : orderReadings(readings).slice(0, SUMMARY_PARAMETERS.length)

  return shown
    .map(reading => `${WATER_PARAMETER_LABELS[reading.parameter]} ${formatReadingValue(reading.parameter, reading.value)}`)
    .join(' · ')
}

/**
 * 歷史記錄的每一列，依量測時間新到舊。
 *
 * 排序在這裡做而不是信任送進來的順序：API 回的那份確實是新到舊，但剛存下的那一筆是
 * 直接插進本地清單的，而使用者補記的可能是上週的量測。
 */
export function buildWaterLogRows(logs: WaterLogDto[], now: Date): WaterLogRow[] {
  return [...logs]
    .sort((left, right) => new Date(right.measuredAt).getTime() - new Date(left.measuredAt).getTime())
    .map((log) => {
      const measuredAt = new Date(log.measuredAt)

      return {
        id: log.id,
        timeText: `${pad(measuredAt.getMonth() + 1)} / ${pad(measuredAt.getDate())} · ${pad(measuredAt.getHours())}:${pad(measuredAt.getMinutes())}`,
        summaryText: summarize(log.readings),
        agoText: formatTimeAgo(log.measuredAt, now),
      }
    })
}
