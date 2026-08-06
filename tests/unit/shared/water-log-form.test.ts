import { describe, expect, it } from 'vitest'
import type { WaterLogDto } from '#shared/types/waterLog'
import type { WaterReadingDto } from '#shared/types/home'
import {
  buildReadingFields,
  buildWaterLogRows,
  composeMeasuredAt,
  defaultMeasuredAtInput,
  mergePreviousReadings,
  parseWaterLogInput,
  readingFieldError,
} from '#shared/utils/waterLog'

// 記錄水質（screen-3，issue #124）畫面上「算得出來的東西」與欄位規則。
//
// 資料那一半（GET / POST /api/tanks/:id/water-logs）已由 PR #127 合併，這裡驗的是
// 畫面這一半：日期＋時間怎麼合成 measuredAt、「上次」從哪裡來、歷史列怎麼排版。
//
// 時區：這一頁的日期與時間是「使用者當地的牆上時間」，所以夾具一律用 Date 的
// 本地建構子（new Date(2026, 6, 8, 21, 30)）而不是 ISO 字串——兩邊都是當地時間，
// runner 的 TZ 設成什麼都不影響斷言。

describe('defaultMeasuredAtInput — 日期預設今天、時間預設現在', () => {
  // Given 我進入「記錄水質」頁 / When 畫面載入
  // Then 日期欄預設為今天、時間欄預設為現在
  it('取的是當地的牆上時間', () => {
    expect(defaultMeasuredAtInput(new Date(2026, 6, 8, 21, 30))).toEqual({
      date: '2026-07-08',
      time: '21:30',
    })
  })

  // <input type="date"> / <input type="time"> 只吃補零過的格式，少一位就整格是空的
  it('個位數的月 / 日 / 時 / 分都補零', () => {
    expect(defaultMeasuredAtInput(new Date(2026, 0, 5, 9, 4))).toEqual({
      date: '2026-01-05',
      time: '09:04',
    })
  })
})

describe('composeMeasuredAt — 日期＋時間合成帶 offset 的 measuredAt', () => {
  it('指的是當地的那一刻', () => {
    const composed = composeMeasuredAt('2026-07-08', '21:30')

    expect(composed).not.toBeNull()
    expect(new Date(composed!).getTime()).toBe(new Date(2026, 6, 8, 21, 30).getTime())
  })

  // server 要求 measuredAt 帶著 UTC offset（server/utils/waterLog.ts 的 parseWaterLogInput）：
  // 畫面上的是牆上時間，存的是量測瞬間，少了 offset 只能猜使用者在哪個時區。
  it('合成的結果過得了 server 的解析，直接送畫面上的字串則不行', () => {
    const composed = composeMeasuredAt('2026-07-08', '21:30')!

    expect(parseWaterLogInput({ measuredAt: composed, readings: { KH: '7.8' } }).ok).toBe(true)
    expect(parseWaterLogInput({ measuredAt: '2026-07-08T21:30', readings: { KH: '7.8' } }).ok).toBe(false)
  })

  it('秒數也帶得出來的 <input type="time"> 一樣合成得出', () => {
    expect(composeMeasuredAt('2026-07-08', '21:30:00')).toBe(composeMeasuredAt('2026-07-08', '21:30'))
  })

  it('日期或時間不完整、不存在、超出範圍時合成不出來', () => {
    expect(composeMeasuredAt('', '21:30')).toBeNull()
    expect(composeMeasuredAt('2026-07-08', '')).toBeNull()
    // 2 月沒有 31 號。交給 Date 會自己滾成 3/3，那一筆會安靜地存進錯的日子
    expect(composeMeasuredAt('2026-02-31', '21:30')).toBeNull()
    expect(composeMeasuredAt('2026-07-08', '24:00')).toBeNull()
    expect(composeMeasuredAt('2026-07-08', '21:60')).toBeNull()
  })
})

describe('readingFieldError — 單一讀值欄位的驗證', () => {
  // Given 我只填了 KH、Ca、Mg，其餘留空 —— 留空是正常的用法，不是錯誤
  it('留空不算錯誤', () => {
    expect(readingFieldError('')).toBeNull()
    expect(readingFieldError('   ')).toBeNull()
  })

  // Given 我在 KH 欄輸入非數字或負數 / When 欄位失焦 / Then 顯示該欄的驗證錯誤
  it('非數字與負數各自有錯誤訊息', () => {
    expect(readingFieldError('abc')).not.toBeNull()
    expect(readingFieldError('-1')).not.toBeNull()
    expect(readingFieldError('7.8.1')).not.toBeNull()
  })

  // 規則以 server 為準（issue #124 第 3 節）：同一組限制寫兩次遲早有一邊先漂走，
  // 所以前端用的是與 parseWaterLogInput 同一份規則。
  it('超過四位小數或超過上限，與 server 擋的是同一組值', () => {
    expect(readingFieldError('1.12345')).not.toBeNull()
    expect(readingFieldError('1000000')).not.toBeNull()

    for (const text of ['abc', '-1', '1.12345', '1000000']) {
      expect(parseWaterLogInput({ measuredAt: '2026-07-08T21:30:00+08:00', readings: { KH: text } }).ok).toBe(false)
    }
  })

  it('合法的讀值沒有錯誤', () => {
    for (const text of ['0', '7.8', '412', '1.026', '0.0400', '999999.9999']) {
      expect(readingFieldError(text)).toBeNull()
    }
  })
})

describe('buildReadingFields — 六個元素輸入欄', () => {
  const PREVIOUS: WaterReadingDto[] = [
    { parameter: 'KH', value: 8 },
    { parameter: 'CA', value: 415 },
    { parameter: 'MG', value: 1240 },
    { parameter: 'NO3', value: 12 },
    { parameter: 'PO4', value: 0.04 },
    { parameter: 'SALINITY', value: 1.026 },
  ]

  // Then 顯示六個元素輸入欄，依序為 KH / Ca / Mg / NO₃ / PO₄ / 鹽度
  it('依序為 KH / Ca / Mg / NO₃ / PO₄ / 鹽度', () => {
    expect(buildReadingFields(PREVIOUS).map(field => field.parameter))
      .toEqual(['KH', 'CA', 'MG', 'NO3', 'PO4', 'SALINITY'])
    expect(buildReadingFields(PREVIOUS).map(field => field.label))
      .toEqual(['KH', 'Ca', 'Mg', 'NO₃', 'PO₄', '鹽度'])
  })

  // And 每欄右側顯示單位（dKH / ppm / ppm / ppm / ppm / SG）與「上次 <值>」
  it('每欄各帶單位與前次讀值', () => {
    expect(buildReadingFields(PREVIOUS).map(field => field.unit))
      .toEqual(['dKH', 'ppm', 'ppm', 'ppm', 'ppm', 'SG'])
    expect(buildReadingFields(PREVIOUS).map(field => field.previousDisplay))
      .toEqual(['8.0', '415', '1240', '12', '.04', '1.026'])
  })

  // Given 該缸該測項從未被記錄過 / When 該欄渲染 / Then 右側不顯示「上次」，只顯示單位
  //
  // 不補 0、也不補「—」當作值：那會讓「還沒量過」與「量過但這次沒填」看起來一樣。
  it('從未量測過的測項沒有前次讀值', () => {
    const fields = buildReadingFields([{ parameter: 'KH', value: 8 }])

    expect(fields.map(field => field.previousDisplay)).toEqual(['8.0', null, null, null, null, null])
    // 單位仍然在
    expect(fields.map(field => field.unit)).toEqual(['dKH', 'ppm', 'ppm', 'ppm', 'ppm', 'SG'])
  })
})

describe('mergePreviousReadings — 剛存下的那一筆成為下一次的「上次」', () => {
  it('有填的測項換成新值，沒填的維持原本的前次讀值', () => {
    expect(mergePreviousReadings(
      [{ parameter: 'KH', value: 8 }, { parameter: 'CA', value: 415 }],
      [{ parameter: 'KH', value: 7.8 }, { parameter: 'MG', value: 1180 }],
    )).toEqual([
      { parameter: 'KH', value: 7.8 },
      { parameter: 'CA', value: 415 },
      { parameter: 'MG', value: 1180 },
    ])
  })
})

describe('buildWaterLogRows — 歷史記錄', () => {
  const NOW = new Date(2026, 6, 8, 21, 30)

  function log(id: string, at: Date, readings: WaterReadingDto[]): WaterLogDto {
    return { id, measuredAt: at.toISOString(), readings }
  }

  const LOGS: WaterLogDto[] = [
    log('log-1', new Date(2026, 6, 4, 21, 0), [
      { parameter: 'KH', value: 8 }, { parameter: 'CA', value: 415 }, { parameter: 'MG', value: 1240 },
    ]),
    log('log-2', new Date(2026, 5, 30, 20, 40), [
      { parameter: 'KH', value: 8.1 }, { parameter: 'CA', value: 418 }, { parameter: 'MG', value: 1250 },
    ]),
    log('log-3', new Date(2026, 5, 26, 21, 15), [
      { parameter: 'KH', value: 7.9 }, { parameter: 'CA', value: 410 }, { parameter: 'MG', value: 1230 },
    ]),
  ]

  // Given 該缸已有 07/04 21:00、06/30 20:40、06/26 21:15 三筆記錄
  // Then 依量測時間新到舊列出，每列顯示「MM / DD · HH:mm」、三項摘要與相對時間
  it('每列顯示「MM / DD · HH:mm」、KH / Ca / Mg 摘要與相對時間', () => {
    expect(buildWaterLogRows(LOGS, NOW)).toEqual([
      { id: 'log-1', timeText: '07 / 04 · 21:00', summaryText: 'KH 8.0 · Ca 415 · Mg 1240', agoText: '4 天前' },
      { id: 'log-2', timeText: '06 / 30 · 20:40', summaryText: 'KH 8.1 · Ca 418 · Mg 1250', agoText: '8 天前' },
      { id: 'log-3', timeText: '06 / 26 · 21:15', summaryText: 'KH 7.9 · Ca 410 · Mg 1230', agoText: '12 天前' },
    ])
  })

  // 送進來的順序不一定是對的：剛存下的那一筆是插進本地清單的（issue #124 第 3 節），
  // 而使用者補記的可能是上週的量測。
  it('不管送進來的順序，一律依量測時間新到舊', () => {
    expect(buildWaterLogRows([LOGS[2]!, LOGS[0]!, LOGS[1]!], NOW).map(row => row.id))
      .toEqual(['log-1', 'log-2', 'log-3'])
  })

  // Given 我只填了 KH、Ca，Mg 留空 —— 沒填的測項不建 WaterReading，摘要也不佔位
  it('這次沒填的測項不出現在摘要裡', () => {
    const rows = buildWaterLogRows([
      log('log-1', new Date(2026, 6, 4, 21, 0), [{ parameter: 'KH', value: 8 }, { parameter: 'CA', value: 415 }]),
    ], NOW)

    expect(rows[0]!.summaryText).toBe('KH 8.0 · Ca 415')
  })

  // 摘要只挑三項是版面決定（390px 塞不下六項）。但「只填 PO₄」是這一頁允許的用法，
  // 照 KH / Ca / Mg 硬取的話那一列會只剩時間，看起來像壞掉的空列。
  it('KH / Ca / Mg 都沒填時，改列這次真的有填的測項', () => {
    const rows = buildWaterLogRows([
      log('log-1', new Date(2026, 6, 4, 21, 0), [
        { parameter: 'NO3', value: 12 }, { parameter: 'PO4', value: 0.04 }, { parameter: 'SALINITY', value: 1.026 },
      ]),
    ], NOW)

    // 摘要用的是 screen-1 那一組較短的標籤（鹽度在這裡是「鹽」），一列才排得下
    expect(rows[0]!.summaryText).toBe('NO₃ 12 · PO₄ .04 · 鹽 1.026')
  })

  // Given 該缸完全沒有水質記錄
  it('沒有記錄時是空清單', () => {
    expect(buildWaterLogRows([], NOW)).toEqual([])
  })
})
