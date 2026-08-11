// @vitest-environment node
// 純函式測試，不碰 Vue 元件、Nuxt composable 或 DOM；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it } from 'vitest'
import type { MaintenanceTaskDto } from '../../../shared/types/maintenance'
import {
  COMPLETED_ON_OUT_OF_RANGE_MESSAGE,
  INVALID_COMPLETED_ON_MESSAGE,
  UPCOMING_WINDOW_DAYS,
  buildMaintenanceSections,
  nextDueOn,
  parseCompletedOn,
  parseCompletedOnInput,
  toLocalDateOnly,
} from '../../../shared/utils/maintenance'

// 保養提醒（screen-7）的推算（issue #122 第 2 節）。
//
// 這些值全部不進資料庫（schema.prisma 的 MaintenanceTask 註解已定案），而且它們都要問
// 一件 server 答不出來的事：**使用者的「今天」是哪一天**。server 跑在 UTC、使用者在
// UTC+8，台北時間 7/09 01:00 在 UTC 還是 7/08——而畫面正是靠這一天分「今天該做」與
// 「即將到期」。所以推算住在 shared，`now` 由呼叫端傳入（與 formatRelativeTime(value, now)、
// parseWaterLogInput(raw, now) 同一個作法），測試不必動系統時鐘。

/**
 * 一個任務。預設是「從未完成過、沒有 startOn」，各條 test 只覆寫自己在乎的欄位——
 * 三層 fallback 的每一層因此都要自己明講，不會有哪一層是靠夾具默默給的。
 */
function task(overrides: Partial<MaintenanceTaskDto> & { id: string }): MaintenanceTaskDto {
  return {
    name: `任務 ${overrides.id}`,
    intervalDays: 7,
    startOn: null,
    createdOn: '2026-06-01',
    displayOrder: 0,
    isActive: true,
    lastCompletion: null,
    ...overrides,
  }
}

/** 完成紀錄。時刻與日曆日刻意不同步（08:20 是台北時間），確認分區看的是 completedOn */
function completedOn(date: string): MaintenanceTaskDto['lastCompletion'] {
  return { completedAt: `${date}T00:20:00.000Z`, completedOn: date }
}

/** 螢幕上那一天的早上 9 點。用當地時間建構，測試在哪個時區跑都是同一個日曆日 */
const MORNING_OF_JULY_8 = new Date(2026, 6, 8, 9, 0)

/**
 * 暫時把行程換到另一個時區跑。
 *
 * Node 在 `process.env.TZ` 被指派時會重新讀取時區設定，所以這是「使用者在 UTC+8、
 * server 在 UTC」唯一測得到的方式——CI 一律跑在 UTC，只用 `new Date(...)` 的話
 * 當地日期與 UTC 日期永遠一致，那條分歧就沒有東西可驗。
 */
function withTimezone<T>(timeZone: string, run: () => T): T {
  const original = process.env.TZ

  process.env.TZ = timeZone

  try {
    return run()
  }
  finally {
    if (original === undefined) {
      delete process.env.TZ
    }
    else {
      process.env.TZ = original
    }
  }
}

// ─────────────────────────────────────────────
// nextDueOn（issue #122 第 4-3 節的規則表第一列）
// ─────────────────────────────────────────────
//
// nextDueOn ＝（最後完成日 ?? startOn ?? createdOn）+ intervalDays 天。
// 三層都要有測試：少了 createdOn 那一層，「從來沒完成過、也沒設 startOn」的任務
// 會算不出到期日，而 schema.prisma 明文說那種任務「視為建立當天起算」。
describe('nextDueOn 的三層 fallback', () => {
  // Given 某個任務有完成紀錄
  it('有完成紀錄時以最後完成日起算', () => {
    expect(nextDueOn(task({
      id: 'water-change',
      intervalDays: 7,
      startOn: '2026-01-01',
      createdOn: '2026-01-01',
      lastCompletion: completedOn('2026-07-01'),
    }))).toBe('2026-07-08')
  })

  // startOn 只在「還沒完成過」時才用得到——上面那一條的 startOn 是 1/1，
  // 若被誤用會算出 1/8，與 7/08 差得很遠，不會兩邊都碰巧對
  it('尚無完成紀錄時以 startOn 起算', () => {
    expect(nextDueOn(task({
      id: 'refractometer',
      intervalDays: 30,
      startOn: '2026-06-08',
      createdOn: '2026-05-01',
    }))).toBe('2026-07-08')
  })

  it('完成紀錄與 startOn 都沒有時以 createdOn 起算', () => {
    expect(nextDueOn(task({
      id: 'new-task',
      intervalDays: 7,
      createdOn: '2026-07-01',
    }))).toBe('2026-07-08')
  })

  // 日期加法不能自己拆字串加減：跨月、跨年、閏日各是一種進位
  it.each([
    ['跨月', '2026-06-28', 7, '2026-07-05'],
    ['跨年', '2026-12-28', 7, '2027-01-04'],
    ['閏年的 2 月', '2028-02-27', 3, '2028-03-01'],
    ['每天', '2026-07-08', 1, '2026-07-09'],
    ['每 60 天', '2026-07-08', 60, '2026-09-06'],
  ])('日期加法會進位（%s）', (_label, from, intervalDays, expected) => {
    expect(nextDueOn(task({ id: 'carry', intervalDays, lastCompletion: completedOn(from) }))).toBe(expected)
  })
})

// ─────────────────────────────────────────────
// 分區與徽章（issue #122 第 4-3 節的規則表其餘四列）
// ─────────────────────────────────────────────
describe('buildMaintenanceSections 的分區', () => {
  /** 螢幕上那一天（7/08）的六個任務，涵蓋每一種分區結果 */
  const TASKS: MaintenanceTaskDto[] = [
    // 每 7 天、6/30 做過 → 7/07 到期，已經逾期
    task({ id: 'overdue', name: '換水 10%', intervalDays: 7, displayOrder: 0, lastCompletion: completedOn('2026-06-30') }),
    // 每天、今天已完成 → nextDueOn 已經是明天，但仍要留在「今天該做」
    task({ id: 'done-today', name: '餵食', intervalDays: 1, displayOrder: 1, lastCompletion: completedOn('2026-07-08') }),
    // 每 7 天、7/02 做過 → 7/09 到期
    task({ id: 'tomorrow', name: '洗前置棉', intervalDays: 7, displayOrder: 2, lastCompletion: completedOn('2026-07-02') }),
    // 每 30 天、6/08 做過 → 7/08 到期，正好是今天
    task({ id: 'due-today', name: '折射計校正', intervalDays: 30, displayOrder: 3, lastCompletion: completedOn('2026-06-08') }),
    // 30 天窗口的邊界：每 37 天、7/01 做過 → 8/07 到期（今天 + 30）
    task({ id: 'window-edge', name: '洗濾材', intervalDays: 37, displayOrder: 4, lastCompletion: completedOn('2026-07-01') }),
    // 每 60 天、6/24 做過 → 8/23 到期（今天 + 46），落在窗口外
    task({ id: 'far-away', name: '換活性碳', intervalDays: 60, displayOrder: 5, lastCompletion: completedOn('2026-06-24') }),
  ]

  const sections = () => buildMaintenanceSections(TASKS, MORNING_OF_JULY_8)

  const ids = (rows: { task: MaintenanceTaskDto }[]) => rows.map(row => row.task.id)

  // Given 某個任務的 nextDueOn 早於今天 / Then 它在「今天該做」，而且標為逾期
  it('逾期的任務落在「今天該做」，並標為逾期', () => {
    const row = sections().today.find(candidate => candidate.task.id === 'overdue')

    expect(row).toMatchObject({ nextDueOn: '2026-07-07', overdue: true, completedToday: false, dueInDays: -1 })
  })

  it('今天到期的任務落在「今天該做」，但不算逾期', () => {
    const row = sections().today.find(candidate => candidate.task.id === 'due-today')

    expect(row).toMatchObject({ nextDueOn: '2026-07-08', overdue: false, completedToday: false, dueInDays: 0 })
  })

  // ⚠ 這一條最容易做錯：「餵食」今天做完之後 nextDueOn 已經是明天，只照 nextDueOn 分區
  // 的話這一列會在勾選的當下跳到「即將到期」去——畫面等於在懲罰使用者完成任務。
  // #15 明文寫著它仍顯示在今天該做區（已勾選、降透明度、不計入徽章）。
  it('今天已完成的任務仍然留在「今天該做」，不會跳到即將到期', () => {
    const { today, upcoming } = sections()

    expect(ids(today)).toContain('done-today')
    expect(ids(upcoming)).not.toContain('done-today')
    expect(today.find(row => row.task.id === 'done-today')).toMatchObject({
      completedToday: true,
      overdue: false,
      // 它的下一次到期確實是明天——分區的依據是「今天已完成」，不是把到期日算錯
      nextDueOn: '2026-07-09',
    })
  })

  // 截圖上「今天該做 ②」的三列順序是 換水 10% → 折射計校正 → 餵食（已完成），
  // 而 displayOrder 是 換水 0 < 餵食 1 < 折射計 3——所以已完成的那一列是被排到最後的，
  // 未完成的兩列之間才照原順序。逾期的排在最前面（到期日由舊到新）。
  it('「今天該做」未完成的排在前面，已完成的殿後', () => {
    expect(ids(sections().today)).toEqual(['overdue', 'due-today', 'done-today'])
  })

  // Given 某個任務明天才到期 / Then 它在「即將到期」，不在「今天該做」
  it('明天到期的任務落在「即將到期」', () => {
    const row = sections().upcoming.find(candidate => candidate.task.id === 'tomorrow')

    expect(row).toMatchObject({ nextDueOn: '2026-07-09', overdue: false, completedToday: false, dueInDays: 1 })
    expect(ids(sections().today)).not.toContain('tomorrow')
  })

  // 30 天窗口是本專案自己定的（#15），所以邊界要釘住：正好第 30 天在裡面、第 46 天不在。
  // 「換活性碳」這一類長週期任務因此會完全不出現在畫面上——issue #122 第 7 節列為已知缺口。
  it('即將到期只收到期日在 UPCOMING_WINDOW_DAYS 天內的任務', () => {
    const { today, upcoming } = sections()

    expect(UPCOMING_WINDOW_DAYS).toBe(30)
    expect(ids(upcoming)).toContain('window-edge')
    expect(ids(upcoming)).not.toContain('far-away')
    expect(ids(today)).not.toContain('far-away')
  })

  it('剛好落在窗口最後一天的任務仍然收進來，多一天就不收', () => {
    // 起算日用 startOn 而不是「今天完成」：後者會讓這兩列因為「今天已完成」而落到
    // 今天該做區，測到的就不是窗口邊界了
    const inside = task({ id: 'inside', intervalDays: UPCOMING_WINDOW_DAYS, startOn: '2026-07-08' })
    const outside = task({ id: 'outside', intervalDays: UPCOMING_WINDOW_DAYS + 1, startOn: '2026-07-08' })

    const { upcoming } = buildMaintenanceSections([inside, outside], MORNING_OF_JULY_8)

    expect(ids(upcoming)).toEqual(['inside'])
  })

  // Given 即將到期有多個任務 / Then 依到期日由近到遠
  it('即將到期依到期日由近到遠排序', () => {
    expect(ids(sections().upcoming)).toEqual(['tomorrow', 'window-edge'])
  })

  it('即將到期的排序不受送進來的順序影響', () => {
    const later = task({ id: 'later', intervalDays: 20, startOn: '2026-07-08', displayOrder: 0 })
    const sooner = task({ id: 'sooner', intervalDays: 5, startOn: '2026-07-08', displayOrder: 1 })

    expect(ids(buildMaintenanceSections([later, sooner], MORNING_OF_JULY_8).upcoming)).toEqual(['sooner', 'later'])
  })

  // Given 今天該做有 3 個任務、其中 1 個已完成 / Then 徽章顯示 2
  // 截圖上的徽章正是這個數字：三列裡「餵食」已勾選，徽章寫 2。
  it('徽章只數「今天該做」之中今天尚未完成的', () => {
    expect(sections().dueCount).toBe(2)
    expect(sections().today).toHaveLength(3)
  })

  it('今天該做的全部完成之後徽章歸零，那些列仍然在', () => {
    const done = TASKS.map(candidate => (candidate.id === 'overdue' || candidate.id === 'due-today')
      ? { ...candidate, lastCompletion: completedOn('2026-07-08') }
      : candidate)

    const { today, dueCount } = buildMaintenanceSections(done, MORNING_OF_JULY_8)

    expect(dueCount).toBe(0)
    // 三列都已完成，彼此之間維持送進來的順序（displayOrder），不再依到期日重排——
    // 已完成的那一段是「今天的成果」，讓它跟著各自的下次到期日跳動沒有意義
    expect(ids(today)).toEqual(['overdue', 'done-today', 'due-today'])
  })

  // `overdue` 的 `!completedToday` 只有在 intervalDays 非正數時才發揮作用：intervalDays 為正時，
  // 今天完成過 ⇒ nextDueOn 至少是明天 ⇒ `due < today` 本來就不成立。而 schema 的 intervalDays
  // 是沒有下限的 Int（建立表單是 #17，還沒有東西擋住 0 或負數），所以那個條件不是死碼，
  // 是防禦——沒有這一條的話，它可以被整條拿掉而測試全綠。
  it('今天完成過的任務不算逾期，就算 intervalDays 是不合理的負數', () => {
    const broken = task({ id: 'broken', intervalDays: -3, lastCompletion: completedOn('2026-07-08') })

    const row = buildMaintenanceSections([broken], MORNING_OF_JULY_8).today[0]

    expect(row).toMatchObject({ nextDueOn: '2026-07-05', completedToday: true, overdue: false })
  })

  it('沒有任何任務時兩區都是空的，徽章是 0', () => {
    expect(buildMaintenanceSections([], MORNING_OF_JULY_8)).toEqual({ today: [], upcoming: [], dueCount: 0 })
  })

  // 從未完成過、也沒有 startOn 的任務照樣要分得出區——它的起算日是 createdOn
  it('從未完成過的任務同樣分得出區', () => {
    const fresh = task({ id: 'fresh', intervalDays: 7, createdOn: '2026-07-01' })
    const stale = task({ id: 'stale', intervalDays: 7, createdOn: '2026-06-01' })

    const { today, upcoming, dueCount } = buildMaintenanceSections([fresh, stale], MORNING_OF_JULY_8)

    expect(ids(today)).toEqual(['stale', 'fresh'])
    expect(upcoming).toEqual([])
    expect(dueCount).toBe(2)
  })
})

// ─────────────────────────────────────────────
// 「今天」是使用者的今天（issue #122 第 2 節）
// ─────────────────────────────────────────────
describe('分區跟著使用者的當地日期走', () => {
  const TASKS: MaintenanceTaskDto[] = [
    // 每 7 天、7/02 做過 → 7/09 到期
    task({ id: 'due-on-9th', intervalDays: 7, lastCompletion: completedOn('2026-07-02') }),
  ]

  const ids = (rows: { task: MaintenanceTaskDto }[]) => rows.map(row => row.task.id)

  // Given 同一組資料 / When 使用者那側的日曆日跨過午夜
  // Then 7/09 到期的任務從「即將到期」移進「今天該做」
  it('午夜之前是即將到期，午夜之後是今天該做', () => {
    const beforeMidnight = buildMaintenanceSections(TASKS, new Date(2026, 6, 8, 23, 30))
    const afterMidnight = buildMaintenanceSections(TASKS, new Date(2026, 6, 9, 0, 30))

    expect(ids(beforeMidnight.upcoming)).toEqual(['due-on-9th'])
    expect(beforeMidnight.dueCount).toBe(0)

    expect(ids(afterMidnight.today)).toEqual(['due-on-9th'])
    expect(afterMidnight.dueCount).toBe(1)
  })

  // 這一條就是「推算為什麼不能放 server」：同一個瞬間，台北已經是 7/09、UTC 還是 7/08。
  // server 自己算「今天」會整整差一天，而畫面正是靠這一天分區。
  it('「今天」取的是當地的日曆日，不是 UTC 的那一天', () => {
    // 台北時間 2026-07-09 01:00
    const instant = new Date('2026-07-08T17:00:00.000Z')

    expect(withTimezone('Asia/Taipei', () => toLocalDateOnly(instant))).toBe('2026-07-09')
    expect(withTimezone('UTC', () => toLocalDateOnly(instant))).toBe('2026-07-08')
  })

  it('同一個瞬間，UTC+8 的使用者看到的是今天該做，UTC 的使用者看到的是即將到期', () => {
    const instant = new Date('2026-07-08T17:00:00.000Z')

    expect(withTimezone('Asia/Taipei', () => ids(buildMaintenanceSections(TASKS, instant).today))).toEqual(['due-on-9th'])
    expect(withTimezone('UTC', () => ids(buildMaintenanceSections(TASKS, instant).upcoming))).toEqual(['due-on-9th'])
  })

  // 「今天已完成」比對的也是當地的日曆日：completedOn 是前端帶上來的當地日期，
  // 拿 UTC 的今天去比會讓 UTC+8 的使用者在每天早上 8 點之前看到自己昨天的勾選
  it('「今天已完成」比對的同樣是當地的日曆日', () => {
    const fed = [task({ id: 'fed', intervalDays: 1, lastCompletion: completedOn('2026-07-09') })]
    const instant = new Date('2026-07-08T17:00:00.000Z')

    const taipei = withTimezone('Asia/Taipei', () => buildMaintenanceSections(fed, instant))
    const utc = withTimezone('UTC', () => buildMaintenanceSections(fed, instant))

    // 台北：今天（7/09）已經勾過了 → 留在今天該做區，而且不計入徽章
    expect(taipei.today[0]).toMatchObject({ completedToday: true })
    expect(taipei.dueCount).toBe(0)

    // UTC：同一筆紀錄變成「明天」的，今天（7/08）當然沒完成——使用者早上勾好的那一列
    // 會整個從今天該做區消失。這正是拿 server 的 UTC today 當「今天」會出的錯。
    expect(utc.today).toEqual([])
    expect(utc.upcoming[0]).toMatchObject({ completedToday: false })
  })
})

// ─────────────────────────────────────────────
// completedOn 的驗證（issue #122 第 5 節）
// ─────────────────────────────────────────────
describe('parseCompletedOn', () => {
  /** server 的現在：2026-07-08T09:00Z */
  const NOW = new Date('2026-07-08T09:00:00.000Z')
  const parse = (value: unknown) => parseCompletedOn(value, NOW)

  it('收下合法的日曆日，換成該日的 UTC 零時（@db.Date 要的形狀）', () => {
    expect(parse('2026-07-08')).toEqual({ ok: true, value: new Date('2026-07-08T00:00:00.000Z') })
  })

  // Given completedOn 不是合法日期 / Then 回 400「完成日期不正確。」
  it.each([
    ['不存在的日期', '2026-02-30'],
    ['空字串', ''],
    ['只有空白', '   '],
    ['沒有補零', '2026-7-8'],
    ['帶了時間', '2026-07-08T00:00:00.000Z'],
    ['不是字串', 20260708],
    ['null', null],
    ['undefined', undefined],
  ])('拒絕不合法的 completedOn（%s）', (_label, value) => {
    expect(parse(value)).toEqual({ ok: false, message: INVALID_COMPLETED_ON_MESSAGE })
  })

  // 差一天的容忍度是為了時區：使用者的「今天」與 server 的 UTC 今天最多差一天
  // （MEASURED_AT_FUTURE_TOLERANCE_MS 是同一個思路）
  it.each([
    ['server 的今天', '2026-07-08'],
    ['UTC-11 的使用者仍在昨天', '2026-07-07'],
    ['UTC+14 的使用者已經是明天', '2026-07-09'],
  ])('接受與 server 今天相差一天以內的 completedOn（%s）', (_label, value) => {
    expect(parse(value).ok).toBe(true)
  })

  // Given completedOn 距離 server 的現在超過一天 / Then 回 400「只能勾選今天的保養。」
  it.each([
    ['前天', '2026-07-06'],
    ['後天', '2026-07-10'],
    ['去年', '2025-07-08'],
    ['年份打錯成 2199', '2199-07-08'],
  ])('拒絕超出容忍度的 completedOn（%s）', (_label, value) => {
    expect(parse(value)).toEqual({ ok: false, message: COMPLETED_ON_OUT_OF_RANGE_MESSAGE })
  })

  // 兩句訊息刻意不同：格式錯與範圍錯是兩件事，講成同一句的話，
  // 補記昨天的人只會回頭反覆檢查自己的日期格式（與 #128 同一個決定）
  it('格式錯與範圍錯給的是不同的訊息', () => {
    expect(INVALID_COMPLETED_ON_MESSAGE).not.toBe(COMPLETED_ON_OUT_OF_RANGE_MESSAGE)
  })

  // 正式呼叫端（server/utils/authorization.ts）不傳 now 時走真實時鐘。
  // 少了這一條，「範圍檢查在 production 到底有沒有生效」沒有任何測試看著。
  it('沒有傳入 now 時以真實時鐘判斷', () => {
    const today = new Date()
    const iso = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`

    expect(parseCompletedOn(iso).ok).toBe(true)
    expect(parseCompletedOn('2199-01-01').ok).toBe(false)
  })

  // 這一支的「今天」刻意取 UTC 而不是當地（見 parseCompletedOn 的註解）：它跑在 server 上，
  // 使用者的今天由前端帶上來的 completedOn 表達。上面那幾條的 NOW 是 09:00Z，在台北是
  // 同一個日曆日，所以把 getUTC* 換成 get* 也照樣全綠——那個立場等於沒有測試守著。
  // 取 UTC 傍晚 20:00（台北已經是隔天 04:00）才分得出來：
  //   UTC 的今天  = 07-08 → 窗口 07-07…07-09
  //   當地的今天  = 07-09 → 窗口 07-08…07-10
  // 兩端各取一個只有其中一種算法會收下的日期。
  it('範圍以 server 的 UTC 今天為準，不隨行程的時區漂移', () => {
    const eveningOfJuly8 = new Date('2026-07-08T20:00:00.000Z')

    withTimezone('Asia/Taipei', () => {
      expect(parseCompletedOn('2026-07-07', eveningOfJuly8).ok).toBe(true)
      expect(parseCompletedOn('2026-07-10', eveningOfJuly8)).toEqual({
        ok: false,
        message: COMPLETED_ON_OUT_OF_RANGE_MESSAGE,
      })
    })
  })
})

describe('parseCompletedOnInput（POST 的 body）', () => {
  const NOW = new Date('2026-07-08T09:00:00.000Z')

  it('取 body 的 completedOn，規則與 parseCompletedOn 同一份', () => {
    expect(parseCompletedOnInput({ completedOn: '2026-07-08' }, NOW))
      .toEqual({ ok: true, value: new Date('2026-07-08T00:00:00.000Z') })
  })

  it.each([
    ['沒有 completedOn', {}],
    ['completedOn 是不存在的日期', { completedOn: '2026-02-30' }],
    ['body 不是物件', 'completedOn=2026-07-08'],
    ['body 是 null', null],
  ])('body 給不出合法的 completedOn 時回同一句訊息（%s）', (_label, body) => {
    expect(parseCompletedOnInput(body, NOW)).toEqual({ ok: false, message: INVALID_COMPLETED_ON_MESSAGE })
  })

  it('body 的 completedOn 超出容忍度時回範圍那一句', () => {
    expect(parseCompletedOnInput({ completedOn: '2026-07-01' }, NOW))
      .toEqual({ ok: false, message: COMPLETED_ON_OUT_OF_RANGE_MESSAGE })
  })
})
