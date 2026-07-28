import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from '../../../shared/utils/relativeTime'

const NOW = new Date('2026-07-28T12:00:00.000Z')

describe('formatRelativeTime', () => {
  // Given 該缸最新一筆水質記錄為 4 小時前
  // Then 水質摘要列顯示相對時間「· 4h」
  it('4 小時前顯示 4h', () => {
    expect(formatRelativeTime('2026-07-28T08:00:00.000Z', NOW)).toBe('4h')
  })

  it('未滿一分鐘顯示「剛剛」', () => {
    expect(formatRelativeTime('2026-07-28T11:59:30.000Z', NOW)).toBe('剛剛')
  })

  it('未滿一小時以分鐘計', () => {
    expect(formatRelativeTime('2026-07-28T11:15:00.000Z', NOW)).toBe('45m')
  })

  it('滿一天以上以天計', () => {
    expect(formatRelativeTime('2026-07-24T12:00:00.000Z', NOW)).toBe('4d')
  })

  it('吃得下 Date 物件，結果與 ISO 字串相同', () => {
    expect(formatRelativeTime(new Date('2026-07-28T08:00:00.000Z'), NOW)).toBe('4h')
  })
})
