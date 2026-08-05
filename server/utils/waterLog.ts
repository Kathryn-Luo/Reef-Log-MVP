import type { PrismaClient, WaterLog, WaterReading } from '@prisma/client'
import type { CreateWaterLogInput, WaterLogPageData, WaterLogRequest } from '#shared/types/waterLog'
import type { WaterParameterKey, WaterReadingDto } from '#shared/types/home'
import { WATER_PARAMETER_ORDER } from '#shared/utils/waterQuality'

function toNumber(value: number | { toString: () => string }): number {
  return typeof value === 'number' ? value : Number(value.toString())
}

function toDto(log: WaterLog & { readings: WaterReading[] }) {
  return {
    id: log.id,
    measuredAt: log.measuredAt.toISOString(),
    readings: log.readings.map(reading => ({ parameter: reading.parameter as WaterParameterKey, value: toNumber(reading.value) })),
  }
}

export function parseWaterLogInput(raw: unknown): { ok: true, value: CreateWaterLogInput } | { ok: false, message: string } {
  const source = typeof raw === 'object' && raw !== null ? raw as Partial<WaterLogRequest> : {}
  const date = typeof source.date === 'string' ? source.date : ''
  const time = typeof source.time === 'string' ? source.time : ''
  const measuredAt = new Date(`${date}T${time}:00.000Z`)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || Number.isNaN(measuredAt.getTime())) {
    return { ok: false, message: '量測日期或時間不正確。' }
  }

  const submitted = source.readings && typeof source.readings === 'object' ? source.readings : {}
  const readings: WaterReadingDto[] = []
  for (const parameter of WATER_PARAMETER_ORDER) {
    const rawValue = submitted[parameter]
    if (rawValue === null || rawValue === undefined || rawValue === '') continue
    const value = typeof rawValue === 'number' ? rawValue : Number(rawValue)
    if (!Number.isFinite(value) || value < 0) return { ok: false, message: '讀值必須是大於或等於零的數字。' }
    readings.push({ parameter, value })
  }

  return readings.length
    ? { ok: true, value: { measuredAt, readings } }
    : { ok: false, message: '至少填寫一項讀值。' }
}

export async function getWaterLogPage(client: PrismaClient, tankId: string): Promise<WaterLogPageData> {
  const logs = await client.waterLog.findMany({
    where: { tankId }, orderBy: { measuredAt: 'desc' }, include: { readings: true },
  })
  const waterLogs = logs.map(toDto)
  const seen = new Set<WaterParameterKey>()
  const previousReadings = waterLogs.flatMap(log => log.readings.filter((reading) => {
    if (seen.has(reading.parameter)) return false
    seen.add(reading.parameter)
    return true
  }))
  return { previousReadings, waterLogs }
}

export async function createWaterLog(client: PrismaClient, tankId: string, input: CreateWaterLogInput): Promise<void> {
  await client.waterLog.create({
    data: { tankId, measuredAt: input.measuredAt, readings: { create: input.readings } },
  })
}
