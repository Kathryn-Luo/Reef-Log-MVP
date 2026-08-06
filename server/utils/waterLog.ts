import type { PrismaClient, WaterLog, WaterReading } from '@prisma/client'
import type { CreateWaterLogInput, PreviousReadingDto, WaterLogDto, WaterLogPageData } from '#shared/types/waterLog'
import type { WaterParameterKey } from '#shared/types/home'
import { WATER_LOG_HISTORY_LIMIT, WATER_PARAMETER_ORDER } from '#shared/utils/waterQuality'

// 水質記錄的資料層（issue #121，畫面是 #11 的 screen-3）。
//
// Prisma Client 由呼叫端傳入，與 homeData.ts、tankWrite.ts 同一個作法：
// 函式因此能在完全連不到資料庫的情況下測試。歸屬檢查不在這裡——這一層收到 tankId
// 時，「這個缸是不是你的」已經由 server/utils/authorization.ts 判斷過了。

// 內容驗證（`parseWaterLogInput`）已搬到 `#shared/utils/waterLog`（issue #124）：
// 記錄水質的表單要在失焦時擋掉同一組值，規則寫兩份的話遲早有一邊先漂走。
// 行為未變，只是換了住址——呼叫端改成直接從 shared 那一支取用。
//
// 不在這裡再匯出一次：那會讓同一個名字同時出現在 shared 與 server 的 auto-import
// 名單上，Nuxt 會印「Duplicated imports」並靜靜地挑一邊。

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
 *
 * `include: { waterLog: true }` 是為了把**量測時間**一起帶回去：畫面在儲存成功後要判斷
 * 剛存下的那一筆是不是比這一筆更近（補記舊資料時不該覆蓋較新的「上次」，issue #131）。
 * 少了它，前端只能從 `waterLogs` 反推，而那份清單有筆數上限——正好就是這支函式獨立查
 * 的原因，反推回去等於把同一個坑再踩一次。
 */
async function getPreviousReadings(client: PrismaClient, tankId: string): Promise<PreviousReadingDto[]> {
  const latest = await Promise.all(WATER_PARAMETER_ORDER.map(parameter =>
    client.waterReading.findFirst({
      where: { parameter, waterLog: { tankId } },
      orderBy: { waterLog: { measuredAt: 'desc' } },
      include: { waterLog: true },
    })))

  return latest.flatMap((reading, index) => reading
    ? [{
        parameter: WATER_PARAMETER_ORDER[index]!,
        value: toNumber(reading.value),
        measuredAt: reading.waterLog.measuredAt.toISOString(),
      }]
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
