import { describe, expect, it } from 'vitest'
import type { WaterReadingDto, WaterSummaryDto, WaterTargetDto } from '#shared/types/home'
import {
  DEFAULT_WATER_TARGETS,
  MISSING_READING_TEXT,
  WATER_PARAMETER_FULL_LABELS,
  WATER_PARAMETER_LABELS,
  WATER_PARAMETER_ORDER,
  WATER_PARAMETER_UNITS,
  buildWaterDashboardRows,
  formatReadingValue,
  formatTargetRange,
  readingStatus,
  resolveWaterTarget,
  summarizeWaterReadings,
} from '#shared/utils/waterQuality'

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

// ── screen-2 數據儀表板（issue #10）────────────────────────────────
//
// 儀表板與 screen-1 的摘要列讀同一組資料，差別在呈現：
// 摘要列只排出「有量到」的測項，儀表板則六列固定到齊，沒量到的那列顯示「—」。

/** screen-2 截圖的六列：Mg 偏低、NO₃ 偏高，其餘正常 */
const SCREEN_2_WATER: WaterSummaryDto = {
  measuredAt: '2026-07-28T05:41:00.000Z',
  readings: [
    { parameter: 'KH', value: 7.8 },
    { parameter: 'CA', value: 412 },
    { parameter: 'MG', value: 1180 },
    { parameter: 'NO3', value: 12 },
    { parameter: 'PO4', value: 0.04 },
    { parameter: 'SALINITY', value: 1.026 },
  ],
  // 截圖右側標示的區間，與 DEFAULT_WATER_TARGETS 刻意不完全相同——
  // 這一組是「該缸自己設定的」WaterParameterTarget
  targets: [
    { parameter: 'KH', minValue: 7, maxValue: 9 },
    { parameter: 'CA', minValue: 380, maxValue: 450 },
    { parameter: 'MG', minValue: 1250, maxValue: 1350 },
    { parameter: 'NO3', minValue: 2, maxValue: 10 },
    { parameter: 'PO4', minValue: 0.02, maxValue: 0.1 },
    { parameter: 'SALINITY', minValue: 1.024, maxValue: 1.027 },
  ],
  trends: [
    { parameter: 'KH', values: [7.6, 7.9, 7.8] },
    { parameter: 'MG', values: [1300, 1260, 1180] },
  ],
}

function rowOf(water: WaterSummaryDto | null, parameter: string) {
  return buildWaterDashboardRows(water).find(row => row.parameter === parameter)!
}

describe('儀表板的測項常數', () => {
  // Then 每列顯示：測項名、數值、單位（dKH / ppm / ppm / ppm / ppm / SG）
  it('單位依 screen-2 標示，且不進資料庫（應用層常數）', () => {
    expect(WATER_PARAMETER_ORDER.map(parameter => WATER_PARAMETER_UNITS[parameter])).toEqual([
      'dKH',
      'ppm',
      'ppm',
      'ppm',
      'ppm',
      'SG',
    ])
  })

  // 摘要列窄，鹽度縮寫成「鹽」；儀表板一列一項，寫得下完整名稱
  it('儀表板用完整測項名，鹽度不再縮寫', () => {
    expect(WATER_PARAMETER_ORDER.map(parameter => WATER_PARAMETER_FULL_LABELS[parameter])).toEqual([
      'KH',
      'Ca',
      'Mg',
      'NO₃',
      'PO₄',
      '鹽度',
    ])
    expect(WATER_PARAMETER_LABELS.SALINITY).toBe('鹽')
  })
})

describe('formatTargetRange', () => {
  // 截圖的區間文字：7–9 / 380–450 / 1250–1350 / 2–10 / .02–.10 / 1.024–1.027
  it('整數上下限不補小數位', () => {
    expect(formatTargetRange('KH', { minValue: 7, maxValue: 9 })).toBe('7–9')
    expect(formatTargetRange('CA', { minValue: 380, maxValue: 450 })).toBe('380–450')
    expect(formatTargetRange('MG', { minValue: 1250, maxValue: 1350 })).toBe('1250–1350')
    expect(formatTargetRange('NO3', { minValue: 2, maxValue: 10 })).toBe('2–10')
  })

  // 帶小數的上下限沿用該測項的顯示精度，小於 1 一樣省略前導 0
  it('帶小數的上下限沿用該測項的精度', () => {
    expect(formatTargetRange('PO4', { minValue: 0.02, maxValue: 0.1 })).toBe('.02–.10')
    expect(formatTargetRange('SALINITY', { minValue: 1.024, maxValue: 1.027 })).toBe('1.024–1.027')
  })
})

describe('buildWaterDashboardRows', () => {
  // Given 該缸最新一筆水質記錄包含六個測項 / When 儀表板展開
  // Then 依序列出 KH / Ca / Mg / NO₃ / PO₄ / 鹽度六列
  it('依固定順序給出六列，含測項名、數值與單位', () => {
    const rows = buildWaterDashboardRows(SCREEN_2_WATER)

    expect(rows.map(row => [row.label, row.display, row.unit])).toEqual([
      ['KH', '7.8', 'dKH'],
      ['Ca', '412', 'ppm'],
      ['Mg', '1180', 'ppm'],
      ['NO₃', '12', 'ppm'],
      ['PO₄', '.04', 'ppm'],
      ['鹽度', '1.026', 'SG'],
    ])
  })

  it('讀數順序打亂也依固定順序輸出', () => {
    const shuffled = { ...SCREEN_2_WATER, readings: [...SCREEN_2_WATER.readings].reverse() }

    expect(buildWaterDashboardRows(shuffled).map(row => row.parameter)).toEqual([...WATER_PARAMETER_ORDER])
  })

  // Given Mg 的最新值為 1180，該缸 Mg 的正常區間為 1250–1350
  // Then 右側顯示藍色「偏低 ▼」與區間文字「1250–1350」，數值同樣以藍色呈現
  it('低於下限 → 偏低 ▼ 與該缸的區間文字', () => {
    const row = rowOf(SCREEN_2_WATER, 'MG')

    expect(row.status).toBe('low')
    expect(row.statusLabel).toBe('偏低')
    expect(row.statusIcon).toBe('▼')
    expect(row.rangeText).toBe('1250–1350')
  })

  // Given NO₃ 的最新值為 12，該缸 NO₃ 的正常區間為 2–10
  // Then 右側顯示橘色「偏高 ▲」與區間文字「2–10」，數值同樣以橘色呈現
  it('高於上限 → 偏高 ▲ 與該缸的區間文字', () => {
    const row = rowOf(SCREEN_2_WATER, 'NO3')

    expect(row.status).toBe('high')
    expect(row.statusLabel).toBe('偏高')
    expect(row.statusIcon).toBe('▲')
    expect(row.rangeText).toBe('2–10')
  })

  // Given KH 的最新值為 7.8，落在正常區間 7–9 內
  // Then 右側顯示「正常」與區間文字「7–9」
  it('落在區間內 → 正常，且不帶方向箭頭', () => {
    const row = rowOf(SCREEN_2_WATER, 'KH')

    expect(row.status).toBe('normal')
    expect(row.statusLabel).toBe('正常')
    expect(row.statusIcon).toBeNull()
    expect(row.rangeText).toBe('7–9')
  })

  // 沒有設定 target 的測項落回應用層預設區間（schema.prisma 的註解要求這條路徑存在）
  it('該缸沒設定區間的測項，區間文字來自應用層預設值', () => {
    const noTargets = { ...SCREEN_2_WATER, targets: [] }

    expect(rowOf(noTargets, 'MG').rangeText).toBe(
      formatTargetRange('MG', DEFAULT_WATER_TARGETS.MG),
    )
  })

  it('把該測項的趨勢數列帶上，沒有歷史的測項為空陣列', () => {
    expect(rowOf(SCREEN_2_WATER, 'MG').trend).toEqual([1300, 1260, 1180])
    expect(rowOf(SCREEN_2_WATER, 'CA').trend).toEqual([])
  })

  // Given 該缸最新一筆記錄中某測項未填寫（該測項無 reading）
  // Then 該列數值顯示「—」，不顯示狀態文字
  it('缺該測項的 reading 時數值顯示「—」，且沒有狀態文字', () => {
    const partial: WaterSummaryDto = {
      ...SCREEN_2_WATER,
      readings: [{ parameter: 'KH', value: 7.8 }],
    }
    const rows = buildWaterDashboardRows(partial)

    // 六列照樣到齊——沒量到的測項是「這次沒測」，不是「不存在」
    expect(rows).toHaveLength(6)

    const missing = rows.find(row => row.parameter === 'PO4')!
    expect(missing.value).toBeNull()
    expect(missing.display).toBe(MISSING_READING_TEXT)
    expect(MISSING_READING_TEXT).toBe('—')
    expect(missing.status).toBeNull()
    expect(missing.statusLabel).toBeNull()
    expect(missing.statusIcon).toBeNull()

    // 區間本身與有沒有量到無關，仍然是這一列的參考值
    expect(missing.rangeText).toBe('.02–.10')
  })

  // And 也不計入首頁的「N 需注意」
  it('未量測的測項不計入首頁的「N 需注意」', () => {
    const partial: WaterReadingDto[] = [
      { parameter: 'KH', value: 7.8 },
      { parameter: 'MG', value: 1180 },
    ]
    const summary = summarizeWaterReadings(partial, SCREEN_2_WATER.targets)

    // 只有 Mg 偏低；其餘四項沒量到，不是「正常」也不是「需注意」
    expect(summary.attentionCount).toBe(1)
    expect(summary.items).toHaveLength(2)

    // 儀表板上那四列同樣不帶狀態
    const rows = buildWaterDashboardRows({ ...SCREEN_2_WATER, readings: partial })
    expect(rows.filter(row => row.status !== null).map(row => row.parameter)).toEqual(['KH', 'MG'])
  })

  // 該缸還沒有任何水質記錄時，儀表板不該整個壞掉
  it('完全沒有水質記錄時六列都是「—」', () => {
    const rows = buildWaterDashboardRows(null)

    expect(rows.map(row => row.display)).toEqual(Array.from({ length: 6 }, () => MISSING_READING_TEXT))
    expect(rows.every(row => row.status === null)).toBe(true)
    expect(rows.every(row => row.trend.length === 0)).toBe(true)

    // 區間是測項的固有參考值，沒有記錄時仍給得出來
    expect(rowOf(null, 'KH').rangeText).toBe(formatTargetRange('KH', DEFAULT_WATER_TARGETS.KH))
  })
})
