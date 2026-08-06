import { describe, expect, it } from 'vitest'
import { formatRelativeTime, formatTimeAgo, formatUpdatedAgo } from '#shared/utils/relativeTime'

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

// screen-2 的副標「主缸 · 更新於 4 小時前」。
// 摘要列的「4h」是給一眼掃過的縮寫，儀表板一次只看一個缸、空間也夠，寫成完整的中文。
describe('formatUpdatedAgo', () => {
  // Then 副標為「<缸名> · 更新於 N 小時前」
  it('4 小時前顯示「更新於 4 小時前」', () => {
    expect(formatUpdatedAgo('2026-07-28T08:00:00.000Z', NOW)).toBe('更新於 4 小時前')
  })

  it('未滿一小時以分鐘計', () => {
    expect(formatUpdatedAgo('2026-07-28T11:15:00.000Z', NOW)).toBe('更新於 45 分鐘前')
  })

  it('滿一天以上以天計', () => {
    expect(formatUpdatedAgo('2026-07-24T12:00:00.000Z', NOW)).toBe('更新於 4 天前')
  })

  // 「更新於 剛剛前」不成話，這一格改用完整的句子
  it('未滿一分鐘顯示「剛剛更新」', () => {
    expect(formatUpdatedAgo('2026-07-28T11:59:30.000Z', NOW)).toBe('剛剛更新')
  })

  it('吃得下 Date 物件，結果與 ISO 字串相同', () => {
    expect(formatUpdatedAgo(new Date('2026-07-28T08:00:00.000Z'), NOW)).toBe('更新於 4 小時前')
  })
})

// screen-3 歷史記錄每一列右側的「4 天前」。
// 與 formatUpdatedAgo 的差別只有前綴：那一句在講「這份資料多新」，
// 這一句貼在某一筆記錄旁邊，主詞已經在左邊了。
describe('formatTimeAgo', () => {
  // Then 每列顯示……相對時間（如「4 天前」）
  it('4 天前顯示「4 天前」', () => {
    expect(formatTimeAgo('2026-07-24T12:00:00.000Z', NOW)).toBe('4 天前')
  })

  it('未滿一天以小時計', () => {
    expect(formatTimeAgo('2026-07-28T08:00:00.000Z', NOW)).toBe('4 小時前')
  })

  it('未滿一小時以分鐘計', () => {
    expect(formatTimeAgo('2026-07-28T11:15:00.000Z', NOW)).toBe('45 分鐘前')
  })

  // 「0 分鐘前」不成話
  it('未滿一分鐘顯示「剛剛」', () => {
    expect(formatTimeAgo('2026-07-28T11:59:30.000Z', NOW)).toBe('剛剛')
  })

  it('吃得下 Date 物件，結果與 ISO 字串相同', () => {
    expect(formatTimeAgo(new Date('2026-07-24T12:00:00.000Z'), NOW)).toBe('4 天前')
  })
})
