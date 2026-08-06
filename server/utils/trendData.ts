import type { PrismaClient, WaterLog, WaterReading } from '@prisma/client'
import type { WaterParameterKey, WaterTargetDto } from '#shared/types/home'
import type { TrendPageData, TrendPointDto, TrendRangeKey, TrendSeriesDto } from '#shared/types/trend'
import { summarizeTrendSeries, trendRangeStart } from '#shared/utils/trend'
import { WATER_PARAMETER_ORDER, resolveWaterTarget } from '#shared/utils/waterQuality'

// 趨勢圖的資料層（issue #126，畫面是 #12 的 screen-4，由 #123 接手畫）。
//
// Prisma Client 由呼叫端傳入，與 homeData.ts、waterLog.ts 同一個作法：函式因此能在
// 完全連不到資料庫的情況下測試。歸屬檢查不在這裡——這一層收到 tankId 時，
// 「這個缸是不是你的」已經由 server/utils/authorization.ts 判斷過了。

/** Prisma 的 Decimal 在型別上不是 number；量測值一律轉成 number 才進 DTO */
function toNumber(value: number | { toString: () => string }): number {
  return typeof value === 'number' ? value : Number(value.toString())
}

/**
 * 把一次查詢回來的 log 依測項分組，串成六組序列。
 *
 * `logs` 已經照 measuredAt 由舊到新排好（查詢的 orderBy），所以每一組的點也就是
 * 由舊到新。某次沒量到的測項不補位——schema.prisma 定義「未量測」就是不建立
 * WaterReading 列，補一個 0 或 null 進去只會畫出假的走勢。
 *
 * 六項一定都在（見 shared/types/trend.ts）：沒有讀值的那一項是空序列，
 * 統計因此全部是 null，而畫面的那個 tab 照樣有正常區間可以畫。
 */
function toSeries(
  logs: (WaterLog & { readings: WaterReading[] })[],
  targets: WaterTargetDto[],
): TrendSeriesDto[] {
  return WATER_PARAMETER_ORDER.map((parameter) => {
    const points = logs.flatMap<TrendPointDto>((log) => {
      const reading = log.readings.find(candidate => candidate.parameter === parameter)

      return reading
        ? [{ measuredAt: log.measuredAt.toISOString(), value: toNumber(reading.value) }]
        : []
    })

    return {
      parameter,
      points,
      ...summarizeTrendSeries(points),
      // fallback 在 server 端做完：前端拿到的一定是可以直接畫的區間。
      // 兩邊各自 fallback 的話，遲早有一邊先漂走。
      target: { parameter, ...resolveWaterTarget(parameter, targets) },
    }
  })
}

/**
 * GET /api/tanks/:id/trends 的內容：六個測項的序列、統計與正常區間。
 *
 * **一次回六個測項**，而不是一次一個：畫面上切換元素 tab 是六選一的即時動作，
 * 每切一次打一次網路的話，六個 tab 就是六種載入樣態；範圍只有四個選項，換範圍才
 * 重打一次是划算的。payload 也不會失控——單缸一年約 50–100 筆 log
 * （見 `WATER_LOG_HISTORY_LIMIT` 的註解），六個測項各一組點就是幾百個數字。
 *
 * 查詢只打一次，走 WaterLog 的 @@index([tankId, measuredAt]) 撈出整個區間，
 * 回來之後在 JS 裡依 parameter 分組：`WaterReading.parameter` 上刻意沒有索引
 * （schema.prisma 的註解說明了為什麼），六個測項各查一次反而是六趟。
 *
 * `createdAt` 當次要排序鍵，理由同 #134：`measuredAt` 是分鐘精度，同一刻的兩筆
 * 若由資料庫決定先後，畫面上方大字的「最新一筆」就沒有保證。
 *
 * `now` 由呼叫端傳入（與 `parseWaterLogInput` 同一個作法），測試才不必假時鐘。
 */
export async function getTrendPage(
  client: PrismaClient,
  tankId: string,
  range: TrendRangeKey,
  now: Date,
): Promise<TrendPageData> {
  const start = trendRangeStart(range, now)

  const [logs, targets] = await Promise.all([
    client.waterLog.findMany({
      // 區間下在 where 上，不是撈回來再在 JS 裡濾：後者等於每次都把整個缸的歷史讀出來
      where: start ? { tankId, measuredAt: { gte: start } } : { tankId },
      orderBy: [{ measuredAt: 'asc' }, { createdAt: 'asc' }],
      include: { readings: true },
    }),
    client.waterParameterTarget.findMany({ where: { tankId } }),
  ])

  return {
    range,
    series: toSeries(logs, targets.map(target => ({
      parameter: target.parameter as WaterParameterKey,
      minValue: toNumber(target.minValue),
      maxValue: toNumber(target.maxValue),
    }))),
  }
}
