// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { WATER_LOG_HISTORY_LIMIT, WATER_PARAMETER_ORDER } from '../../../shared/utils/waterQuality'
import { createWaterLog, getWaterLogPage, parseWaterLogInput } from '../../../server/utils/waterLog'

function decimal(value: string) {
  return { toString: () => value }
}

interface ReadingRow { parameter: string, value: { toString: () => string } }
interface LogRow { id: string, measuredAt: Date, readings: ReadingRow[] }

/**
 * `rows` 是這個缸的水質記錄，由新到舊。
 *
 * `waterReading.findFirst` 照 getPreviousReadings 實際下的條件在記憶體裡找：
 * 依 waterLog.measuredAt 由新到舊、取該測項的第一筆。一律回同一個值的話，
 * 「前次讀值取的是最近一筆」就沒有東西可驗。
 */
function fakeClient(rows: LogRow[] = []) {
  const client = {
    waterLog: {
      findMany: vi.fn().mockResolvedValue(rows),
      // nested create 的回傳照 Prisma 的樣子攤平：readings: { create: [...] } 進去，
      // 出來的是實際的列
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({
        ...data, id: 'log-new', readings: data.readings?.create ?? [],
      })),
    },
    waterReading: {
      findFirst: vi.fn(({ where }: { where: { parameter: string } }) => Promise.resolve(
        rows.flatMap(log => log.readings).find(reading => reading.parameter === where.parameter) ?? null,
      )),
    },
  }
  return client as unknown as PrismaClient & typeof client
}

describe('parseWaterLogInput', () => {
  it('接受部分 readings，並保留帶 offset 的量測瞬間', () => {
    expect(parseWaterLogInput({
      measuredAt: '2026-08-05T21:30:00+08:00', readings: { KH: 7.8, CA: 420, MG: null, NO3: '', PO4: 0.04 },
    })).toEqual({
      ok: true,
      value: {
        measuredAt: new Date('2026-08-05T13:30:00.000Z'),
        readings: [{ parameter: 'KH', value: 7.8 }, { parameter: 'CA', value: 420 }, { parameter: 'PO4', value: 0.04 }],
      },
    })
  })

  it('拒絕空 readings、負數與非有限數值', () => {
    expect(parseWaterLogInput({ measuredAt: '2026-08-05T21:30:00+08:00', readings: {} }).ok).toBe(false)
    expect(parseWaterLogInput({ measuredAt: '2026-08-05T21:30:00+08:00', readings: { KH: -1 } }).ok).toBe(false)
    expect(parseWaterLogInput({ measuredAt: '2026-08-05T21:30:00+08:00', readings: { KH: 'NaN' } }).ok).toBe(false)
    expect(parseWaterLogInput({ measuredAt: '2026-02-31T21:30:00+08:00', readings: { KH: 7.8 } }).ok).toBe(false)
    expect(parseWaterLogInput({ measuredAt: '2026-08-05T21:30:00+08:00', readings: { KH: false } }).ok).toBe(false)
    expect(parseWaterLogInput({ measuredAt: '2026-08-05T21:30:00+08:00', readings: { KH: [] } }).ok).toBe(false)
    expect(parseWaterLogInput({ measuredAt: '2026-08-05T21:30:00+08:00', readings: { KH: '   ' } }).ok).toBe(false)
    expect(parseWaterLogInput({ measuredAt: '2026-08-05T21:30:00+08:00', readings: { KH: 1000000 } }).ok).toBe(false)
    expect(parseWaterLogInput({ measuredAt: '2026-08-05T21:30:00+08:00', readings: { KH: '1.12345' } }).ok).toBe(false)
    expect(parseWaterLogInput({ measuredAt: '2026-08-05T24:00:00+08:00', readings: { KH: 7.8 } }).ok).toBe(false)
  })
})

describe('water log data', () => {
  it('取得歷史與各測項前次讀值，Decimal 轉為 number', async () => {
    const client = fakeClient([{
      id: 'log-1', measuredAt: new Date('2026-08-04T12:00:00.000Z'), readings: [
        { parameter: 'KH', value: decimal('7.8000') }, { parameter: 'PO4', value: decimal('0.0400') },
      ],
    }])

    await expect(getWaterLogPage(client, 'tank-1')).resolves.toEqual({
      previousReadings: [{ parameter: 'KH', value: 7.8 }, { parameter: 'PO4', value: 0.04 }],
      waterLogs: [{ id: 'log-1', measuredAt: '2026-08-04T12:00:00.000Z', readings: [{ parameter: 'KH', value: 7.8 }, { parameter: 'PO4', value: 0.04 }] }],
    })
    // 歷史有筆數上限，否則記錄了三年的缸會把全部 log 連同 readings 一次撈回來
    expect(client.waterLog.findMany).toHaveBeenCalledWith({
      where: { tankId: 'tank-1' },
      orderBy: { measuredAt: 'desc' },
      take: WATER_LOG_HISTORY_LIMIT,
      include: { readings: true },
    })
  })

  it('只建立填寫的 readings', async () => {
    const client = fakeClient()
    const input = parseWaterLogInput({ measuredAt: '2026-08-05T21:30:00+08:00', readings: { KH: 7.8, PO4: 0.04 } })
    if (!input.ok) throw new Error('fixture must be valid')

    const created = await createWaterLog(client, 'tank-1', input.value)

    expect(client.waterLog.create).toHaveBeenCalledWith({
      data: {
        tankId: 'tank-1', measuredAt: new Date('2026-08-05T13:30:00.000Z'),
        readings: { create: [{ parameter: 'KH', value: 7.8 }, { parameter: 'PO4', value: 0.04 }] },
      },
      include: { readings: true },
    })
    // 回傳剛寫進去的那一筆：畫面要把它插到歷史列表最上方（#11），
    // 回空物件的話 UI 只能整包重抓
    expect(created).toEqual({
      id: 'log-new',
      measuredAt: '2026-08-05T13:30:00.000Z',
      readings: [{ parameter: 'KH', value: 7.8 }, { parameter: 'PO4', value: 0.04 }],
    })
  })

  // 「上次 8.0」取的是該測項最近一筆已存在的讀值，不是「最近 N 筆歷史裡的最後一筆」。
  // 從歷史推導的話，某個測項上一次量測落在 take 之外時那一格會憑空消失。
  it('前次讀值與歷史各自查，不受歷史筆數上限影響', async () => {
    const client = fakeClient([{
      id: 'log-1', measuredAt: new Date('2026-08-04T12:00:00.000Z'),
      readings: [{ parameter: 'KH', value: decimal('7.8000') }],
    }])

    await getWaterLogPage(client, 'tank-1')

    // 六個測項各一次 LIMIT 1，都帶著這個缸的條件
    expect(client.waterReading.findFirst).toHaveBeenCalledTimes(WATER_PARAMETER_ORDER.length)
    expect(client.waterReading.findFirst).toHaveBeenCalledWith({
      where: { parameter: 'KH', waterLog: { tankId: 'tank-1' } },
      orderBy: { waterLog: { measuredAt: 'desc' } },
    })
  })

  // 從未量測過的測項不回傳假值：畫面因此分得出「還沒量過」與「量過但這次沒填」
  it('從未量測過的測項不出現在前次讀值裡', async () => {
    const page = await getWaterLogPage(fakeClient(), 'tank-1')

    expect(page.previousReadings).toEqual([])
    expect(page.waterLogs).toEqual([])
  })
})
