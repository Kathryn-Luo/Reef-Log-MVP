import type { PrismaClient, WaterLog, WaterReading } from '@prisma/client'
import type { CreateWaterLogInput, WaterLogDto, WaterLogPageData, WaterLogRequest } from '#shared/types/waterLog'
import type { WaterParameterKey, WaterReadingDto } from '#shared/types/home'
import { WATER_LOG_HISTORY_LIMIT, WATER_PARAMETER_ORDER } from '#shared/utils/waterQuality'

// 水質記錄的資料層（issue #121，畫面是 #11 的 screen-3）。
//
// Prisma Client 由呼叫端傳入，與 homeData.ts、tankWrite.ts 同一個作法：
// 函式因此能在完全連不到資料庫的情況下測試。歸屬檢查不在這裡——這一層收到 tankId
// 時，「這個缸是不是你的」已經由 server/utils/authorization.ts 判斷過了。

/**
 * 讀值的上限，來自 schema.prisma 的 `WaterReading.value @db.Decimal(10, 4)`：
 * 整數部分最多 6 位、小數 4 位。超過的話 Prisma 會在寫入時才丟錯，
 * 那時使用者已經按下儲存、也已經走完一次往返——擋在解析這一步比較誠實。
 *
 * ⚠ 這個常數與下面的 `WATER_READING_DECIMALS`（合起來就是 `WATER_READING_PATTERN`）
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

/** 讀值的形狀：非負、最多 WATER_READING_DECIMALS 位小數，不收科學記號 */
const WATER_READING_PATTERN = new RegExp(`^\\d+(?:\\.\\d{1,${WATER_READING_DECIMALS}})?$`)

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

/** Prisma 的 Decimal 在型別上不是 number；量測值一律轉成 number 才進 DTO */
function toNumber(value: number | { toString: () => string }): number {
  return typeof value === 'number' ? value : Number(value.toString())
}

function toDto(log: WaterLog & { readings: WaterReading[] }): WaterLogDto {
  return {
    id: log.id,
    measuredAt: log.measuredAt.toISOString(),
    readings: log.readings.map(reading => ({ parameter: reading.parameter as WaterParameterKey, value: toNumber(reading.value) })),
  }
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
    return { ok: false, message: '量測日期或時間不正確。' }
  }

  // 訊息刻意與上面那句不同：格式錯與範圍錯是兩件事，講成同一句的話，
  // 年份打錯的人只會回頭反覆檢查自己的日期格式。
  if (measuredAt.getTime() > now.getTime() + MEASURED_AT_FUTURE_TOLERANCE_MS
    || measuredAt.getTime() < MEASURED_AT_EARLIEST_MS) {
    return { ok: false, message: '量測時間不合理：不能早於 2000 年，也不能比現在晚超過一天。' }
  }

  const submitted = source.readings && typeof source.readings === 'object' ? source.readings : {}
  const readings: WaterReadingDto[] = []
  for (const parameter of WATER_PARAMETER_ORDER) {
    const rawValue = submitted[parameter]
    if (rawValue === null || rawValue === undefined || rawValue === '') continue
    if (typeof rawValue !== 'number' && typeof rawValue !== 'string') {
      return { ok: false, message: '讀值必須是大於或等於零的數字。' }
    }
    const normalized = typeof rawValue === 'string' ? rawValue.trim() : String(rawValue)
    const value = Number(normalized)
    // 這一行是精度保證本身，不只是「擋掉奇怪的輸入」——理由見 EXACT_ROUND_TRIP_DIGITS
    if (!WATER_READING_PATTERN.test(normalized) || !Number.isFinite(value) || value > MAX_WATER_READING) {
      return { ok: false, message: '讀值必須是介於 0 和 999999.9999 的數字，且最多四位小數。' }
    }
    readings.push({ parameter, value })
  }

  return readings.length
    ? { ok: true, value: { measuredAt, readings } }
    : { ok: false, message: '至少填寫一項讀值。' }
}

/**
 * 每個測項最近一筆已存在的讀值——畫面上每一欄右側的「上次 8.0」。
 *
 * 六個測項各查一次 `LIMIT 1`，而不是從歷史那份清單推導。理由是筆數上限：
 * 某個測項上一次量測若落在 `WATER_LOG_HISTORY_LIMIT` 之外，從清單推導會讓那一格
 * 憑空消失，而 #11 要的是「該缸該測項**最近一筆已存在**的讀值」。
 *
 * 六次而不是一次 `distinct`：`WaterReading` 上刻意沒有 `parameter` 索引
 * （schema.prisma 的註解），一次撈回來再分組等於又變成無上限的讀取。
 * 六個查詢各自 `LIMIT 1`、走 `WaterLog` 的 @@index([tankId, measuredAt])，
 * 而且一起併發送出——成本是可預期的，不會隨著這個缸記錄了多久而變。
 *
 * 從未量測過的測項不會出現在回傳值裡：畫面因此分得出「還沒量過」（不顯示「上次」）
 * 與「量過但這次沒填」。
 */
async function getPreviousReadings(client: PrismaClient, tankId: string): Promise<WaterReadingDto[]> {
  const latest = await Promise.all(WATER_PARAMETER_ORDER.map(parameter =>
    client.waterReading.findFirst({
      where: { parameter, waterLog: { tankId } },
      orderBy: { waterLog: { measuredAt: 'desc' } },
    })))

  return latest.flatMap((reading, index) => reading
    ? [{ parameter: WATER_PARAMETER_ORDER[index]!, value: toNumber(reading.value) }]
    : [])
}

/** GET /api/tanks/:id/water-logs 的內容：歷史記錄與每個測項的前次讀值 */
export async function getWaterLogPage(client: PrismaClient, tankId: string): Promise<WaterLogPageData> {
  const [logs, previousReadings] = await Promise.all([
    client.waterLog.findMany({
      where: { tankId },
      orderBy: { measuredAt: 'desc' },
      // 上限的理由與「為什麼前次讀值要獨立查」寫在 WATER_LOG_HISTORY_LIMIT 上
      take: WATER_LOG_HISTORY_LIMIT,
      include: { readings: true },
    }),
    getPreviousReadings(client, tankId),
  ])

  return { previousReadings, waterLogs: logs.map(toDto) }
}

/**
 * 寫入一筆量測，並回傳剛寫進去的那一筆。
 *
 * nested create：log 與它的 readings 在同一次寫入裡完成，中途失敗不會留下一筆
 * 沒有任何讀值的空記錄。未填的測項不建 `WaterReading`——schema.prisma 的註解
 * 已定案「未量測」以不建立該列表示，而不是存 null。
 *
 * 回傳新記錄而不是空物件：畫面要把它插到歷史列表最上方（#11），
 * 回空的話 UI 只能整包重抓一次。
 */
export async function createWaterLog(
  client: PrismaClient,
  tankId: string,
  input: CreateWaterLogInput,
): Promise<WaterLogDto> {
  const log = await client.waterLog.create({
    data: { tankId, measuredAt: input.measuredAt, readings: { create: input.readings } },
    include: { readings: true },
  })

  return toDto(log)
}
