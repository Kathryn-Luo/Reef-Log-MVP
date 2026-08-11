// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  MAINTENANCE_INTERVAL_OPTIONS,
  parseMaintenanceTaskInput,
} from '../../../shared/utils/maintenanceTaskForm'

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

  it.each(['tankId', 'displayOrder', 'note', 'completions'])('不接受受保護欄位 %s', (field) => {
    expect(parseMaintenanceTaskInput({ ...VALID_INPUT, [field]: 'tampered' }))
      .toEqual({ ok: false, message: '保養任務表單不能修改所在缸、排序或完成履歷。' })
  })
})
