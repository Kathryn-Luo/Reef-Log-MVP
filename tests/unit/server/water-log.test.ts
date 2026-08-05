// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createWaterLog, getWaterLogPage, parseWaterLogInput } from '../../../server/utils/waterLog'

function decimal(value: string) {
  return { toString: () => value }
}

function fakeClient(rows: unknown[] = []) {
  const client = {
    waterLog: {
      findMany: vi.fn().mockResolvedValue(rows),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'log-new', ...data })),
    },
  }
  return client as unknown as PrismaClient & typeof client
}

describe('parseWaterLogInput', () => {
  it('接受部分 readings，並將日期與時間合成 UTC measuredAt', () => {
    expect(parseWaterLogInput({
      date: '2026-08-05', time: '21:30', readings: { KH: 7.8, CA: 420, MG: null, NO3: '', PO4: 0.04 },
    })).toEqual({
      ok: true,
      value: {
        measuredAt: new Date('2026-08-05T21:30:00.000Z'),
        readings: [{ parameter: 'KH', value: 7.8 }, { parameter: 'CA', value: 420 }, { parameter: 'PO4', value: 0.04 }],
      },
    })
  })

  it('拒絕空 readings、負數與非有限數值', () => {
    expect(parseWaterLogInput({ date: '2026-08-05', time: '21:30', readings: {} }).ok).toBe(false)
    expect(parseWaterLogInput({ date: '2026-08-05', time: '21:30', readings: { KH: -1 } }).ok).toBe(false)
    expect(parseWaterLogInput({ date: '2026-08-05', time: '21:30', readings: { KH: 'NaN' } }).ok).toBe(false)
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
    expect(client.waterLog.findMany).toHaveBeenCalledWith({ where: { tankId: 'tank-1' }, orderBy: { measuredAt: 'desc' }, include: { readings: true } })
  })

  it('只建立填寫的 readings', async () => {
    const client = fakeClient()
    const input = parseWaterLogInput({ date: '2026-08-05', time: '21:30', readings: { KH: 7.8, PO4: 0.04 } })
    if (!input.ok) throw new Error('fixture must be valid')

    await createWaterLog(client, 'tank-1', input.value)

    expect(client.waterLog.create).toHaveBeenCalledWith({ data: {
      tankId: 'tank-1', measuredAt: new Date('2026-08-05T21:30:00.000Z'),
      readings: { create: [{ parameter: 'KH', value: 7.8 }, { parameter: 'PO4', value: 0.04 }] },
    } })
  })
})
