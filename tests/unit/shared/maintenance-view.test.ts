// @vitest-environment node
// 純函式測試，不碰 Vue 元件、Nuxt composable 或 DOM；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it } from 'vitest'
import type { MaintenanceTaskDto } from '../../../shared/types/maintenance'
import { buildMaintenanceSections } from '../../../shared/utils/maintenance'
import {
  buildTodayRowViews,
  buildUpcomingRowViews,
  formatMaintenanceDate,
} from '../../../shared/utils/maintenanceView'

// 保養提醒（screen-7）畫面上「算得出來的字串」（issue #125）。
//
// 分區、徽章與 nextDueOn 全部由 #122 的 buildMaintenanceSections 給（那一份由
// tests/unit/shared/maintenance.test.ts 守著），這裡只管把 MaintenanceRow 排版成
// 一列上看得到的三段字：任務名、副標、右側狀態。
//
// 時區：副標的「已完成 08:20」讀的是使用者當地的牆上時間，所以夾具一律用 Date 的
// 本地建構子（new Date(2026, 6, 8, 8, 20)）而不是寫死的 ISO 字串——寫死的話，
// runner 換一個時區就會變成別的鐘點。

const NOW = new Date(2026, 6, 8, 9, 30) // 當地時間 2026-07-08（週三）09:30
const TODAY = '2026-07-08'

function task(overrides: Partial<MaintenanceTaskDto> & { id: string, name: string }): MaintenanceTaskDto {
  return {
    intervalDays: 7,
    startOn: null,
    createdOn: '2026-06-01',
    displayOrder: 0,
    lastCompletion: null,
    ...overrides,
  }
}

/** 某天做完的那一筆。時間預設當地 08:20，副標的「已完成 08:20」就是它 */
function doneOn(dateOnly: string, hours = 8, minutes = 20) {
  const [year, month, day] = dateOnly.split('-').map(Number) as [number, number, number]

  return {
    completedAt: new Date(year, month - 1, day, hours, minutes).toISOString(),
    completedOn: dateOnly,
  }
}

/** 走一遍畫面真正的路徑：任務 → 分區 → 每一列的字串 */
function sections(tasks: MaintenanceTaskDto[]) {
  const built = buildMaintenanceSections(tasks, NOW)

  return {
    today: buildTodayRowViews(built.today),
    upcoming: buildUpcomingRowViews(built.upcoming),
    dueCount: built.dueCount,
  }
}

// Given 我進入「保養」頁 / When 畫面載入
// Then 頁首顯示「保養提醒」與副標「<缸名> · N 月 N 日 週X」
describe('頁首副標的日期', () => {
  it('是「N 月 N 日 週X」，取使用者當地的今天', () => {
    expect(formatMaintenanceDate(NOW)).toBe('7 月 8 日 週三')
  })

  it('月與日不補零，週幾跟著當地的星期走', () => {
    expect(formatMaintenanceDate(new Date(2026, 7, 5, 23, 59))).toBe('8 月 5 日 週三')
    expect(formatMaintenanceDate(new Date(2026, 0, 1, 0, 0))).toBe('1 月 1 日 週四')
  })
})

// Given 某任務「換水 10%」每 7 天一次、上次完成於 07/01，今天是 07/08
// Then 副標為「每 7 天 · 上次 07/01」，右側顯示「今天」
describe('今天該做的每一列', () => {
  it('副標是「每 N 天 · 上次 MM/DD」，右側是「今天」', () => {
    const { today } = sections([
      task({ id: 'water', name: '換水 10%', intervalDays: 7, lastCompletion: doneOn('2026-07-01') }),
    ])

    expect(today).toHaveLength(1)
    expect(today[0]).toMatchObject({
      id: 'water',
      name: '換水 10%',
      subtitle: '每 7 天 · 上次 07/01',
      statusText: '今天',
      completedToday: false,
      overdue: false,
    })
  })

  // 「每天」而不是「每 1 天」——截圖上「餵食」那一列寫的是「每天」
  it('每 1 天的任務，週期寫成「每天」', () => {
    const { today } = sections([
      task({ id: 'feed', name: '餵食', intervalDays: 1, lastCompletion: doneOn('2026-07-07') }),
    ])

    expect(today[0]!.subtitle).toBe('每天 · 上次 07/07')
  })

  // 從未做過的任務沒有「上次」可寫，只留週期——用「上次 —」佔位的話，
  // 「還沒做過」與「做過但沒有紀錄」會長得一模一樣（與 /log 的「上次」同一個決定）
  it('從未完成過的任務，副標只有週期', () => {
    const { today } = sections([
      task({ id: 'new', name: '新任務', intervalDays: 7, startOn: '2026-07-01' }),
    ])

    expect(today[0]!.subtitle).toBe('每 7 天')
  })

  // Given 某任務已逾期（下次到期日早於今天）
  // Then 該任務仍出現在「今天該做」區，並以逾期樣式標示天數
  it('逾期的列標示逾期天數，且標記本身是文字而不只是顏色', () => {
    const { today } = sections([
      task({ id: 'late', name: '折射計校正', intervalDays: 30, lastCompletion: doneOn('2026-06-05') }),
    ])

    // 上次 06/05 + 30 天 = 07/05，今天 07/08 → 逾期 3 天
    expect(today[0]).toMatchObject({ overdue: true, statusText: '逾期 3 天' })
  })

  // 「逾期 3 天」是 -dueInDays，畫面不自己再減一次日期（issue #125 第 3 節）
  it('逾期天數取自 dueInDays，不重算日期', () => {
    const { today } = sections([
      task({ id: 'late', name: '洗前置棉', intervalDays: 7, lastCompletion: doneOn('2026-06-20') }),
    ])

    // 06/20 + 7 = 06/27，距 07/08 是 11 天
    expect(today[0]!.statusText).toBe('逾期 11 天')
  })

  // Given 「餵食」為每天一次且我今天已完成於 08:20
  // Then 該任務顯示已勾選的 checkbox、文字降透明度，副標為「每天 · 已完成 08:20」
  it('今天已完成的列，副標換成「每天 · 已完成 HH:mm」且不再顯示右側狀態', () => {
    const { today, dueCount } = sections([
      task({ id: 'feed', name: '餵食', intervalDays: 1, lastCompletion: doneOn(TODAY, 8, 20) }),
    ])

    expect(today[0]).toMatchObject({
      completedToday: true,
      subtitle: '每天 · 已完成 08:20',
      // 已完成的列右側不再需要「今天」——同一列的 checkbox 與副標已經把狀態說完了
      statusText: '',
      overdue: false,
    })
    // And 不計入「今天該做」的數字徽章
    expect(dueCount).toBe(0)
  })

  it('完成時間補零成兩位數', () => {
    const { today } = sections([
      task({ id: 'feed', name: '餵食', intervalDays: 1, lastCompletion: doneOn(TODAY, 7, 5) }),
    ])

    expect(today[0]!.subtitle).toBe('每天 · 已完成 07:05')
  })
})

// Given 「洗前置棉」每 7 天、下次到期為 7/11；「洗濾材 / 生化球」每 30 天、下次到期為 7/22
// Then 兩者出現在「即將到期」區，依到期日由近到遠排序
// And 每列左側顯示到期日的日 / 月方塊，右側顯示「N 天後」
describe('即將到期的每一列', () => {
  const upcoming = () => sections([
    task({ id: 'media', name: '洗濾材 / 生化球', intervalDays: 30, lastCompletion: doneOn('2026-06-22') }),
    task({ id: 'floss', name: '洗前置棉', intervalDays: 7, lastCompletion: doneOn('2026-07-04') }),
  ]).upcoming

  it('依到期日由近到遠', () => {
    expect(upcoming().map(row => row.id)).toEqual(['floss', 'media'])
  })

  it('左側是到期日的日 / 月方塊，右側是「N 天後」', () => {
    expect(upcoming()[0]).toMatchObject({
      name: '洗前置棉',
      dayText: '11',
      monthText: '7月',
      dueText: '3 天後',
    })
    expect(upcoming()[1]).toMatchObject({
      name: '洗濾材 / 生化球',
      dayText: '22',
      monthText: '7月',
      dueText: '14 天後',
    })
  })

  // 截圖上 8/05 到期的那一列寫的是「05」，不是「5」
  it('日期方塊的日補零，月份跨月時跟著走', () => {
    const [row] = sections([
      task({ id: 'carbon', name: '換活性碳', intervalDays: 30, lastCompletion: doneOn('2026-07-06') }),
    ]).upcoming

    // 07/06 + 30 = 08/05
    expect(row).toMatchObject({ dayText: '05', monthText: '8月' })
  })

  // 這一區的副標只有週期（4-2）：「上次」在這裡沒有意義，左側方塊講的已經是「下次」
  it('副標只有週期，沒有「上次」', () => {
    expect(upcoming()[0]!.subtitle).toBe('每 7 天')
  })
})
