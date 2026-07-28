import { describe, expect, it } from 'vitest'
import type { WaterReadingDto, WaterTargetDto } from '../../../shared/types/home'
import {
  DEFAULT_WATER_TARGETS,
  WATER_PARAMETER_LABELS,
  WATER_PARAMETER_ORDER,
  formatReadingValue,
  readingStatus,
  resolveWaterTarget,
  summarizeWaterReadings,
} from '../../../shared/utils/waterQuality'

// screen-1 的水質摘要列：KH 7.8 / Ca 412 / Mg 1180 / NO₃ 12 / PO₄ .04 / 鹽 1.026，
// 其中 Mg 偏低（藍）、NO₃ 偏高（橘），其餘正常（綠）→ 徽章「2 需注意」。
const SCREEN_1_READINGS: WaterReadingDto[] = [
  { parameter: 'KH', value: 7.8 },
  { parameter: 'CA', value: 412 },
  { parameter: 'MG', value: 1180 },
  { parameter: 'NO3', value: 12 },
  { parameter: 'PO4', value: 0.04 },
  { parameter: 'SALINITY', value: 1.026 },
]

describe('六個測項的定義', () => {
  // Then 六項元素 KH / Ca / Mg / NO₃ / PO₄ / 鹽 以彩色數字並排顯示
  it('順序與標籤與 screen-1 一致', () => {
    expect(WATER_PARAMETER_ORDER).toEqual(['KH', 'CA', 'MG', 'NO3', 'PO4', 'SALINITY'])
    expect(WATER_PARAMETER_ORDER.map(parameter => WATER_PARAMETER_LABELS[parameter])).toEqual([
      'KH',
      'Ca',
      'Mg',
      'NO₃',
      'PO₄',
      '鹽',
    ])
  })
})

describe('resolveWaterTarget', () => {
  it('該缸有設定 target 時以設定值為準', () => {
    const targets: WaterTargetDto[] = [{ parameter: 'KH', minValue: 8, maxValue: 8.5 }]

    expect(resolveWaterTarget('KH', targets)).toEqual({ minValue: 8, maxValue: 8.5 })
  })

  // schema.prisma 的 WaterParameterTarget 註解：沒有設定的測項由應用層套用預設區間
  it('沒有設定 target 的測項落回應用層預設區間', () => {
    expect(resolveWaterTarget('MG', [])).toEqual(DEFAULT_WATER_TARGETS.MG)
  })
})

describe('readingStatus', () => {
  // Then 正常項為綠色、偏低為藍色、偏高為橘色
  it.each([
    ['低於下限 → 偏低', 1180, 'low'],
    ['等於下限 → 正常', 1250, 'normal'],
    ['區間內 → 正常', 1300, 'normal'],
    ['等於上限 → 正常', 1350, 'normal'],
    ['高於上限 → 偏高', 1400, 'high'],
  ])('%s', (_title, value, expected) => {
    expect(readingStatus(value as number, DEFAULT_WATER_TARGETS.MG)).toBe(expected)
  })
})

describe('formatReadingValue', () => {
  it('依測項的慣用精度顯示，與 screen-1 的數字一致', () => {
    expect(formatReadingValue('KH', 7.8)).toBe('7.8')
    expect(formatReadingValue('CA', 412)).toBe('412')
    expect(formatReadingValue('MG', 1180)).toBe('1180')
    expect(formatReadingValue('NO3', 12)).toBe('12')
    expect(formatReadingValue('SALINITY', 1.026)).toBe('1.026')
  })

  // 截圖的 PO₄ 顯示為「.04」而不是「0.04」
  it('小於 1 的值省略小數點前的 0', () => {
    expect(formatReadingValue('PO4', 0.04)).toBe('.04')
  })
})

describe('summarizeWaterReadings', () => {
  // Given 最新一筆水質記錄中 Mg 低於正常區間、NO₃ 高於正常區間
  // Then 水質摘要列顯示橘色徽章「2 需注意」
  it('數出區間外的測項數量', () => {
    const summary = summarizeWaterReadings(SCREEN_1_READINGS, [])

    expect(summary.attentionCount).toBe(2)
  })

  it('逐項標出正常 / 偏低 / 偏高，並依固定順序排列', () => {
    const summary = summarizeWaterReadings(SCREEN_1_READINGS, [])

    expect(summary.items.map(item => [item.label, item.display, item.status])).toEqual([
      ['KH', '7.8', 'normal'],
      ['Ca', '412', 'normal'],
      ['Mg', '1180', 'low'],
      ['NO₃', '12', 'high'],
      ['PO₄', '.04', 'normal'],
      ['鹽', '1.026', 'normal'],
    ])
  })

  it('讀數順序打亂也依 screen-1 的固定順序輸出', () => {
    const summary = summarizeWaterReadings([...SCREEN_1_READINGS].reverse(), [])

    expect(summary.items.map(item => item.parameter)).toEqual([...WATER_PARAMETER_ORDER])
  })

  it('該缸自訂的 target 會蓋掉預設區間，連帶改變需注意的數量', () => {
    const targets: WaterTargetDto[] = [{ parameter: 'MG', minValue: 1100, maxValue: 1350 }]
    const summary = summarizeWaterReadings(SCREEN_1_READINGS, targets)

    expect(summary.items.find(item => item.parameter === 'MG')?.status).toBe('normal')
    expect(summary.attentionCount).toBe(1)
  })

  // screen-3 允許只填部分測項，未填的測項不會有 WaterReading 列
  it('只有部分測項時，缺的測項不出現在摘要列', () => {
    const summary = summarizeWaterReadings([{ parameter: 'KH', value: 7.8 }], [])

    expect(summary.items.map(item => item.parameter)).toEqual(['KH'])
    expect(summary.attentionCount).toBe(0)
  })
})
