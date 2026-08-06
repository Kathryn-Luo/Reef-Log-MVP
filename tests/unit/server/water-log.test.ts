// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { WATER_LOG_HISTORY_LIMIT, WATER_PARAMETER_ORDER } from '../../../shared/utils/waterQuality'
// parseWaterLogInput 與它的四個常數搬到了 shared（issue #124：記錄水質的表單要用
// 同一份規則）。這些斷言一個字都沒改——它們就是「只搬移、不改行為」的證據。
import {
  EXACT_ROUND_TRIP_DIGITS,
  MAX_WATER_READING,
  MEASURED_AT_EARLIEST_MS,
  MEASURED_AT_FUTURE_TOLERANCE_MS,
  WATER_READING_DECIMALS,
  parseWaterLogInput,
} from '../../../shared/utils/waterLog'
import { createWaterLog, getWaterLogPage } from '../../../server/utils/waterLog'

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
      // include: { waterLog: true } 之後回傳的列帶著它所屬的那筆 log，
      // 前次讀值的 measuredAt 就是從這裡來的
      findFirst: vi.fn(({ where }: { where: { parameter: string } }) => Promise.resolve(
        rows.flatMap(log => log.readings.map(reading => ({ ...reading, waterLog: log })))
          .find(reading => reading.parameter === where.parameter) ?? null,
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

// ─────────────────────────────────────────────
// 量測時間的範圍（issue #128 第 1 節）
// ─────────────────────────────────────────────
//
// 走 issue 列出的方向 C「只擋離譜的」：這一輪要防的是輸入錯誤（把 2026 打成 2299），
// 不是防弊。上限因此給到「現在 + 1 天」——A 的「不得晚於現在」會誤傷手機時鐘快幾分鐘
// 的人，而「剛量完就記錄」正是這支 API 最常見的用法。下限只擋到 2000 年、不拿缸的
// startedOn 當界線：新缸還沒開就先配水試測是真實情境（issue 表格裡 B 的代價）。
//
// `now` 由呼叫端傳入，與 shared/utils/creatureDetail.ts 的 daysInTank(creature, now)
// 同一個作法：測試不必動系統時鐘，也不會在 CI 跨過午夜那一刻偶發失敗。
describe('parseWaterLogInput 的量測時間範圍', () => {
  const NOW = new Date('2026-08-06T09:00:00.000Z')
  const MINUTE = 60_000
  const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()
  const parseAt = (measuredAt: string) => parseWaterLogInput({ measuredAt, readings: { KH: 7.8 } }, NOW)

  // Given 我送出一筆量測時間在未來的水質記錄
  // When  server 收到它
  // Then  拒絕，訊息說明量測時間不合理（授權層把它轉成 400，見 authorization.test.ts）
  it.each([
    ['年份打錯成 2199', '2199-01-01T00:00:00+08:00'],
    ['現在 + 2 天', at(2 * MEASURED_AT_FUTURE_TOLERANCE_MS)],
    ['剛好越過上限一分鐘', at(MEASURED_AT_FUTURE_TOLERANCE_MS + MINUTE)],
  ])('拒絕未來的量測時間（%s）', (_label, measuredAt) => {
    // 「日期或時間不正確」是格式那一關的說法，而這幾筆的格式完全正確。
    // 訊息要說得出真正的原因，否則使用者只會回頭反覆檢查自己打的數字。
    expect(parseAt(measuredAt)).toEqual({ ok: false, message: expect.stringContaining('量測時間') })
  })

  // Given 我送出一筆量測時間是現在（或幾分鐘內的誤差）
  // When  server 收到它
  // Then  正常建立
  it.each([
    ['現在', at(0)],
    ['裝置時鐘快 3 分鐘', at(3 * MINUTE)],
    ['裝置時鐘慢 3 分鐘', at(-3 * MINUTE)],
    ['上限邊界：現在 + 1 天', at(MEASURED_AT_FUTURE_TOLERANCE_MS)],
    ['幾年前補登的舊記錄', '2021-03-14T21:30:00+08:00'],
    ['下限邊界：2000-01-01T00:00:00Z', new Date(MEASURED_AT_EARLIEST_MS).toISOString()],
  ])('接受 %s', (_label, measuredAt) => {
    expect(parseAt(measuredAt)).toEqual({
      ok: true,
      value: { measuredAt: new Date(measuredAt), readings: [{ parameter: 'KH', value: 7.8 }] },
    })
  })

  it('拒絕早於下限的量測時間', () => {
    expect(parseAt('1999-12-31T23:59:59Z')).toEqual({ ok: false, message: expect.stringContaining('量測時間') })
  })

  // 正式的呼叫端（createOwnedWaterLog）不傳 now，走的是這個預設值。
  // 少了這一條，「範圍檢查在 production 到底有沒有生效」沒有任何測試看著。
  it('沒有傳入 now 時以真實時鐘判斷', () => {
    const reject = parseWaterLogInput({ measuredAt: '2199-01-01T00:00:00+08:00', readings: { KH: 7.8 } })
    const accept = parseWaterLogInput({ measuredAt: new Date(Date.now() - MINUTE).toISOString(), readings: { KH: 7.8 } })

    expect(reject.ok).toBe(false)
    expect(accept.ok).toBe(true)
  })
})

// ─────────────────────────────────────────────
// 讀值的精度（issue #128 第 2 節）
// ─────────────────────────────────────────────
//
// 讀值走 JS number 再交給 Prisma 的 Decimal(10, 4)，目前不會失真——但安全來自
// 「規則只收 6 位整數 + 4 位小數」這件事，不是來自浮點數本身。這一組把那個隱性保證
// 寫成可執行的斷言：規則一旦放寬到超過 double 能精確往返的位數，第一條就會變紅，
// 不會像現在這樣「開始掉尾數了，卻沒有任何測試變紅」。
describe('讀值的精度保證來自解析規則，不是浮點數本身', () => {
  const measuredAt = '2026-08-05T21:30:00+08:00'
  const now = new Date('2026-08-06T09:00:00.000Z')

  /** 規則放行的最長數字有幾位有效數字：整數位數（MAX_WATER_READING）+ 小數位數 */
  const ruleDigits = String(Math.trunc(MAX_WATER_READING)).length + WATER_READING_DECIMALS

  it('規則放行的位數仍在 double 能精確往返的範圍內', () => {
    expect(ruleDigits).toBeLessThanOrEqual(EXACT_ROUND_TRIP_DIGITS)
  })

  it('規則放行的極端值，經過 JS number 之後仍拿得回原值', () => {
    for (const text of ['999999.9999', '0.0001', '1.026', '0.04', '7.8', '412']) {
      const parsed = parseWaterLogInput({ measuredAt, readings: { KH: text } }, now)

      if (!parsed.ok) throw new Error(`${text} 應該被規則接受`)

      expect(String(parsed.value.readings[0]!.value)).toBe(text)
    }
  })

  it('位數超過那條線的值會掉尾數，而規則正好擋著它們', () => {
    const tooPrecise = '999999.99999999999999'

    // 這就是規則在保護的東西：放行的話，寫進資料庫的已經不是使用者打的那個數字
    expect(String(Number(tooPrecise))).not.toBe(tooPrecise)
    expect(parseWaterLogInput({ measuredAt, readings: { KH: tooPrecise } }, now).ok).toBe(false)
  })
})

describe('water log data', () => {
  it('取得歷史與各測項前次讀值，Decimal 轉為 number', async () => {
    const client = fakeClient([{
      id: 'log-1', measuredAt: new Date('2026-08-04T12:00:00.000Z'), readings: [
        { parameter: 'KH', value: decimal('7.8000') }, { parameter: 'PO4', value: decimal('0.0400') },
      ],
    }])

    // 前次讀值各自帶著自己的 measuredAt：畫面的樂觀更新要拿它跟剛存下的那一筆比大小，
    // 從歷史清單反推不行——歷史有筆數上限，落在截斷之外的測項就查不到時間了（issue #131）
    await expect(getWaterLogPage(client, 'tank-1')).resolves.toEqual({
      previousReadings: [
        { parameter: 'KH', value: 7.8, measuredAt: '2026-08-04T12:00:00.000Z' },
        { parameter: 'PO4', value: 0.04, measuredAt: '2026-08-04T12:00:00.000Z' },
      ],
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
      include: { waterLog: true },
    })
  })

  // 從未量測過的測項不回傳假值：畫面因此分得出「還沒量過」與「量過但這次沒填」
  it('從未量測過的測項不出現在前次讀值裡', async () => {
    const page = await getWaterLogPage(fakeClient(), 'tank-1')

    expect(page.previousReadings).toEqual([])
    expect(page.waterLogs).toEqual([])
  })
})
