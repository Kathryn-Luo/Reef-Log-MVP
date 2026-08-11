// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  MAINTENANCE_INTERVAL_OPTIONS,
  MAX_MAINTENANCE_INTERVAL_DAYS,
  maxMaintenanceIntervalDays,
  parseMaintenanceTaskInput,
} from '../../../shared/utils/maintenanceTaskForm'
import { addDays } from '../../../shared/utils/maintenance'

const VALID_INPUT = {
  name: ' 換活性碳 ',
  intervalDays: '60',
  startOn: '2026-06-12',
  isActive: true,
}

describe('parseMaintenanceTaskInput', () => {
  it('四個週期 chip 對應每天、每週、每月與每兩個月', () => {
    expect(MAINTENANCE_INTERVAL_OPTIONS).toEqual([
      { value: 1, label: '每天' },
      { value: 7, label: '每週' },
      { value: 30, label: '每月' },
      { value: 60, label: '每兩個月' },
    ])
  })

  it('正規化名稱、週期、日期與啟用狀態', () => {
    expect(parseMaintenanceTaskInput(VALID_INPUT)).toEqual({
      ok: true,
      value: {
        name: '換活性碳',
        intervalDays: 60,
        startOn: '2026-06-12',
        isActive: true,
      },
    })
  })

  it('名稱是必填欄位', () => {
    expect(parseMaintenanceTaskInput({ ...VALID_INPUT, name: '  ' }))
      .toEqual({ ok: false, message: '請輸入任務名稱。' })
  })

  it.each([0, -1, 1.5, '1.5', '每天', '', null])('拒絕不是正整數的週期：%s', (intervalDays) => {
    expect(parseMaintenanceTaskInput({ ...VALID_INPUT, intervalDays }))
      .toEqual({ ok: false, message: '週期天數請填正整數。' })
  })

  it.each([2_147_483_648, Number.MAX_SAFE_INTEGER])('拒絕超出可儲存範圍的週期：%s', (intervalDays) => {
    expect(parseMaintenanceTaskInput({ ...VALID_INPUT, intervalDays }))
      .toEqual({ ok: false, message: '週期天數超過可支援範圍。' })
  })

  it('絕對上限只在最早四位數日期可通過，超過一天就被拒絕', () => {
    expect(parseMaintenanceTaskInput({ ...VALID_INPUT, startOn: '0000-01-01', intervalDays: MAX_MAINTENANCE_INTERVAL_DAYS }))
      .toMatchObject({ ok: true, value: { intervalDays: MAX_MAINTENANCE_INTERVAL_DAYS } })
    expect(parseMaintenanceTaskInput({ ...VALID_INPUT, startOn: '0000-01-01', intervalDays: MAX_MAINTENANCE_INTERVAL_DAYS + 1 }))
      .toEqual({ ok: false, message: '週期天數超過可支援範圍。' })
  })

  it('依實際起算日限制結果不得超過 9999-12-31', () => {
    const maximum = maxMaintenanceIntervalDays('2026-06-12')

    expect(addDays('2026-06-12', maximum)).toBe('9999-12-31')
    expect(parseMaintenanceTaskInput({ ...VALID_INPUT, intervalDays: maximum }))
      .toMatchObject({ ok: true, value: { intervalDays: maximum } })
    expect(parseMaintenanceTaskInput({ ...VALID_INPUT, intervalDays: maximum + 1 }))
      .toEqual({ ok: false, message: '週期天數超過可支援範圍。' })
    expect(parseMaintenanceTaskInput({ ...VALID_INPUT, intervalDays: 3_000_000 }))
      .toEqual({ ok: false, message: '週期天數超過可支援範圍。' })
  })

  it('起算日留白時以保存的當地建立日檢查日期上限', () => {
    const maximum = maxMaintenanceIntervalDays('2026-08-11')

    expect(parseMaintenanceTaskInput(
      { ...VALID_INPUT, startOn: '', intervalDays: maximum },
      { fallbackStartOn: '2026-08-11' },
    ))
      .toMatchObject({ ok: true, value: { intervalDays: maximum } })
    expect(parseMaintenanceTaskInput(
      { ...VALID_INPUT, startOn: '', intervalDays: maximum + 1 },
      { fallbackStartOn: '2026-08-11' },
    ))
      .toEqual({ ok: false, message: '週期天數超過可支援範圍。' })
  })

  it('有完成紀錄時以最後完成日而非較早的 startOn 檢查上限', () => {
    expect(parseMaintenanceTaskInput(
      { ...VALID_INPUT, startOn: '2026-06-12', intervalDays: 2 },
      { fallbackStartOn: '2026-06-01', lastCompletedOn: '9999-12-30' },
    )).toEqual({ ok: false, message: '週期天數超過可支援範圍。' })
  })

  it('起算日留白寫入 null', () => {
    expect(parseMaintenanceTaskInput({ ...VALID_INPUT, startOn: ' ' })).toMatchObject({
      ok: true,
      value: { startOn: null },
    })
  })

  it.each(['2026/06/12', '2026-02-30', 'not-a-date'])('拒絕不合法的起算日：%s', (startOn) => {
    expect(parseMaintenanceTaskInput({ ...VALID_INPUT, startOn }))
      .toEqual({ ok: false, message: '起算日請選擇一個實際存在的日期。' })
  })

  it('未提供 isActive 時預設啟用，也接受明確停用', () => {
    expect(parseMaintenanceTaskInput({ ...VALID_INPUT, isActive: undefined })).toMatchObject({
      ok: true,
      value: { isActive: true },
    })
    expect(parseMaintenanceTaskInput({ ...VALID_INPUT, isActive: false })).toMatchObject({
      ok: true,
      value: { isActive: false },
    })
  })

  it('拒絕不合法的啟用狀態', () => {
    expect(parseMaintenanceTaskInput({ ...VALID_INPUT, isActive: 'false' }))
      .toEqual({ ok: false, message: '啟用狀態不正確。' })
  })

  it.each(['tankId', 'displayOrder', 'createdOn', 'note', 'completions'])('不接受受保護欄位 %s', (field) => {
    expect(parseMaintenanceTaskInput({ ...VALID_INPUT, [field]: 'tampered' }))
      .toEqual({ ok: false, message: '保養任務表單不能修改所在缸、排序或完成履歷。' })
  })
})
