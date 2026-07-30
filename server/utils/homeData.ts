import type { PrismaClient, Tank, WaterLog, WaterReading } from '@prisma/client'
import type {
  CreatureDto,
  TankHomeData,
  TankOption,
  WaterSummaryDto,
  WaterTrendDto,
} from '#shared/types/home'
import { WATER_PARAMETER_ORDER, WATER_TREND_POINTS } from '#shared/utils/waterQuality'

// 首頁（screen-1）的資料查詢。
//
// Prisma Client 由呼叫端傳入（server/utils/prisma.ts 的實例），與 currentContext.ts 同一個作法：
// 函式因此能在完全連不到資料庫的情況下用假 client 測試。

/** Prisma 的 Decimal 直接序列化會變成物件，一律先轉 number 再送出前端 */
function toNumber(value: number | { toString: () => string }): number {
  return typeof value === 'number' ? value : Number(value.toString())
}

/** @db.Date 的欄位固定成 UTC 的 YYYY-MM-DD，月數推算才不會因時區位移一天 */
function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

/**
 * Tank → 頁首與缸切換選單需要的欄位。
 * 缸清單與「剛建立的缸」（server/utils/tankWrite.ts）共用同一份形狀，
 * 兩邊才不會各自挑欄位而漏掉其中一個。
 */
export function toTankOption(tank: Tank): TankOption {
  return {
    id: tank.id,
    name: tank.name,
    sizeSpec: tank.sizeSpec,
    volumeLiters: tank.volumeLiters,
    setupType: tank.setupType,
    colorHex: tank.colorHex,
  }
}

/**
 * 缸切換選單的來源。排序與過濾條件依 schema.prisma 的 Tank.displayOrder 註解：
 * ORDER BY displayOrder ASC, createdAt ASC，且已封存（archivedAt 非 null）的缸不出現。
 * 清單中的第一個同時就是「預設缸」——schema 刻意沒有 isDefault 旗標。
 */
export async function listTankOptions(client: PrismaClient, userId: string): Promise<TankOption[]> {
  const tanks = await client.tank.findMany({
    where: { userId, archivedAt: null },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
  })

  return tanks.map(toTankOption)
}

/**
 * 把最近數筆記錄依測項分組，串成 screen-2 迷你趨勢線的數列。
 *
 * 傳入的 logs 是查詢回傳的順序（measuredAt 由新到舊），這裡反過來輸出，
 * 折線才是左舊右新。某次沒量到的測項不補位——schema.prisma 定義「未量測」
 * 就是不建立 WaterReading 列，補一個 0 或 null 進去只會畫出假的走勢。
 */
function toTrends(logs: (WaterLog & { readings: WaterReading[] })[]): WaterTrendDto[] {
  const chronological = [...logs].reverse()

  return WATER_PARAMETER_ORDER.flatMap<WaterTrendDto>((parameter) => {
    const values = chronological.flatMap((log) => {
      const reading = log.readings.find(candidate => candidate.parameter === parameter)

      return reading ? [toNumber(reading.value)] : []
    })

    return values.length ? [{ parameter, values }] : []
  })
}

/**
 * 首頁單一缸的內容：最近數筆水質記錄（含讀數與該缸設定的正常區間）與全部生物。
 *
 * 只打一次 waterLog 查詢：最新一筆（screen-1 的摘要列）就是這個窗口的第一列，
 * 整個窗口則是 screen-2 迷你趨勢線的來源，兩者本來就是同一份資料。
 * 查詢走 WaterLog 的 @@index([tankId, measuredAt])，依 schema.prisma 的註解，
 * WaterReading 上不建 parameter 索引，分組留在應用層做。
 *
 * 「N 需注意」「· 4h」「存活 · N 月」「×2」都不在這裡算——它們是純顯示推算，
 * 由 shared/utils 的函式在前端完成，這裡只負責把原始資料轉成可序列化的形狀。
 */
export async function getTankHome(client: PrismaClient, tankId: string): Promise<TankHomeData> {
  const [recentLogs, targets, creatures] = await Promise.all([
    client.waterLog.findMany({
      where: { tankId },
      orderBy: { measuredAt: 'desc' },
      take: WATER_TREND_POINTS,
      include: { readings: true },
    }),
    client.waterParameterTarget.findMany({ where: { tankId } }),
    client.creature.findMany({
      where: { tankId },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const latestLog = recentLogs[0]

  const water: WaterSummaryDto | null = latestLog
    ? {
        measuredAt: latestLog.measuredAt.toISOString(),
        readings: latestLog.readings.map(reading => ({
          parameter: reading.parameter,
          value: toNumber(reading.value),
        })),
        targets: targets.map(target => ({
          parameter: target.parameter,
          minValue: toNumber(target.minValue),
          maxValue: toNumber(target.maxValue),
        })),
        trends: toTrends(recentLogs),
      }
    : null

  const cards: CreatureDto[] = creatures.map(creature => ({
    id: creature.id,
    name: creature.name,
    category: creature.category,
    status: creature.status,
    photoUrl: creature.photoUrl,
    addedOn: toDateOnly(creature.addedOn),
    ailment: creature.ailment,
    diedOn: creature.diedOn ? toDateOnly(creature.diedOn) : null,
  }))

  return { water, creatures: cards }
}
