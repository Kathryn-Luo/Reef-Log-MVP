import { describe, expect, it } from 'vitest'
import type { CreatureListItemDto } from '#shared/types/creature'
import {
  CREATURE_STATUS_FILTERS,
  DEATH_CAUSE_LABELS,
  buildInventoryRows,
  daysObserved,
  filterCreatures,
  formatMonthDay,
} from '#shared/utils/creatureInventory'

const NOW = new Date('2026-07-28T09:41:00.000Z')

function creature(
  overrides: Partial<CreatureListItemDto> & Pick<CreatureListItemDto, 'id' | 'name'>,
): CreatureListItemDto {
  return {
    scientificName: null,
    category: 'FISH',
    status: 'ALIVE',
    photoUrl: null,
    addedOn: '2025-11-28',
    ailment: null,
    observedSickOn: null,
    diedOn: null,
    causeOfDeath: null,
    ...overrides,
  }
}

describe('daysObserved', () => {
  // Given 某隻生物狀態為生病，症狀為白點，發病日為 3 天前 / Then 顯示「觀察第 3 天」
  it('發病日為 3 天前時算作第 3 天', () => {
    expect(daysObserved('2026-07-25', NOW)).toBe(3)
  })

  it('當天發病時算作第 0 天', () => {
    expect(daysObserved('2026-07-28', NOW)).toBe(0)
  })

  // @db.Date 一律以 UTC 解讀（與 monthsInTank 同一個基準），不因執行機器的時區位移一天
  it('日期字串以 UTC 解讀', () => {
    expect(daysObserved('2026-07-25T00:00:00.000Z', NOW)).toBe(3)
  })
})

describe('formatMonthDay', () => {
  // Given 某隻生物死亡日為 05/20 / Then 第二行顯示「跳缸 · 05 / 20」
  it('把 YYYY-MM-DD 轉成「05 / 20」', () => {
    expect(formatMonthDay('2026-05-20')).toBe('05 / 20')
  })

  it('個位數的月與日補零', () => {
    expect(formatMonthDay('2026-01-09')).toBe('01 / 09')
  })
})

describe('DEATH_CAUSE_LABELS', () => {
  // schema.prisma 的 enum DeathCause ↔ 中文標籤對照表（issue #13「涉及的資料模型」）。
  // 標籤文字取自 schema.prisma 上每個 enum 值的註解，不另行改寫——
  // screen-6 的死因選單之後會用同一份對照表。
  it('六種死因都有中文標籤', () => {
    expect(DEATH_CAUSE_LABELS).toEqual({
      DISEASE: '生病',
      WATER_QUALITY: '水質變化',
      PREDATION: '被獵食 / 打架',
      JUMPED: '跳缸',
      STARVATION: '餓死（不開口）',
      UNKNOWN: '原因不明',
    })
  })
})

describe('CREATURE_STATUS_FILTERS', () => {
  // Then 狀態 filter 顯示「全部 / 存活 / 生病 / 死亡」
  it('依序為全部 / 存活 / 生病 / 死亡', () => {
    expect(CREATURE_STATUS_FILTERS.map(filter => filter.key)).toEqual(['ALL', 'ALIVE', 'SICK', 'DEAD'])
    expect(CREATURE_STATUS_FILTERS.map(filter => filter.label)).toEqual(['全部', '存活', '生病', '死亡'])
  })
})

describe('filterCreatures', () => {
  const creatures = [
    creature({ id: 'f1', name: '藍倒吊' }),
    creature({ id: 'f2', name: '黃三角', status: 'SICK', ailment: '白點', observedSickOn: '2026-07-25' }),
    creature({ id: 'f3', name: '火焰仙', status: 'DEAD', diedOn: '2026-05-20', causeOfDeath: 'JUMPED' }),
    creature({ id: 'c1', name: '榔頭珊瑚', category: 'CORAL' }),
    creature({ id: 'c2', name: '火炬珊瑚', category: 'CORAL', status: 'SICK' }),
    creature({ id: 'o1', name: '白襪清潔蝦', category: 'OTHER' }),
  ]

  // Given 我在「魚」分類且狀態 filter 為「全部」
  // Then 只顯示 category 為 FISH 的生物，包含存活、生病與死亡者
  it('狀態為「全部」時，該分類的三種狀態都留下', () => {
    expect(filterCreatures(creatures, 'FISH', 'ALL').map(item => item.id)).toEqual(['f1', 'f2', 'f3'])
  })

  // When 我點擊狀態「生病」/ Then 只顯示 status 為 SICK 的魚
  it('狀態為「生病」時只留下該分類中生病的生物', () => {
    expect(filterCreatures(creatures, 'FISH', 'SICK').map(item => item.id)).toEqual(['f2'])
  })

  it('狀態為「存活」「死亡」時同樣只留下該狀態', () => {
    expect(filterCreatures(creatures, 'FISH', 'ALIVE').map(item => item.id)).toEqual(['f1'])
    expect(filterCreatures(creatures, 'FISH', 'DEAD').map(item => item.id)).toEqual(['f3'])
  })

  it('分類與狀態各自獨立套用', () => {
    expect(filterCreatures(creatures, 'CORAL', 'SICK').map(item => item.id)).toEqual(['c2'])
    expect(filterCreatures(creatures, 'OTHER', 'ALL').map(item => item.id)).toEqual(['o1'])
  })

  // Given 目前的分類與狀態組合沒有任何生物
  it('沒有符合的生物時回傳空陣列', () => {
    expect(filterCreatures(creatures, 'OTHER', 'DEAD')).toEqual([])
  })
})

describe('buildInventoryRows', () => {
  // Given 某隻存活生物有學名且入缸 8 個月
  // Then 第一行顯示俗名，第二行顯示「<學名> · 入缸 8 月」，右側顯示綠點與「存活」
  it('存活且有學名時，副標為「<學名> · 入缸 N 月」', () => {
    const [row] = buildInventoryRows(
      [creature({ id: 'f1', name: '藍倒吊', scientificName: 'Paracanthurus', addedOn: '2025-11-28' })],
      NOW,
    )

    expect(row).toMatchObject({
      id: 'f1',
      title: '藍倒吊',
      subtitle: 'Paracanthurus · 入缸 8 月',
      status: 'ALIVE',
      statusLabel: '存活',
    })
  })

  // Given 某隻生物沒有填學名 / Then 第二行只顯示「入缸 N 月」，不出現多餘的分隔點
  it('沒有學名時副標只有「入缸 N 月」，不留下多餘的分隔點', () => {
    const [row] = buildInventoryRows(
      [creature({ id: 'f1', name: '藍倒吊', scientificName: null, addedOn: '2025-11-28' })],
      NOW,
    )

    expect(row?.subtitle).toBe('入缸 8 月')
    expect(row?.subtitle).not.toContain('·')
  })

  // Given 某隻生物狀態為生病，症狀為白點，發病日為 3 天前
  // Then 第二行顯示「白點 · 觀察第 3 天」，右側顯示橘點與「生病」
  it('生病時副標為「<症狀> · 觀察第 N 天」', () => {
    const [row] = buildInventoryRows(
      [creature({
        id: 'f2',
        name: '黃三角',
        scientificName: 'Zebrasoma flavescens',
        status: 'SICK',
        ailment: '白點',
        observedSickOn: '2026-07-25',
      })],
      NOW,
    )

    expect(row).toMatchObject({
      title: '黃三角',
      subtitle: '白點 · 觀察第 3 天',
      status: 'SICK',
      statusLabel: '生病',
    })
  })

  it('生病但沒填症狀時只顯示觀察天數', () => {
    const [row] = buildInventoryRows(
      [creature({ id: 'f2', name: '黃三角', status: 'SICK', observedSickOn: '2026-07-25' })],
      NOW,
    )

    expect(row?.subtitle).toBe('觀察第 3 天')
  })

  it('生病但沒有發病日時退回「觀察中」', () => {
    const [row] = buildInventoryRows([creature({ id: 'f2', name: '黃三角', status: 'SICK' })], NOW)

    expect(row?.subtitle).toBe('觀察中')
  })

  // Given 某隻生物狀態為死亡，死因為跳缸，死亡日為 05/20
  // Then 第二行顯示「跳缸 · 05 / 20」，右側顯示灰點與「死亡」
  it('死亡時副標為「<死因> · MM / DD」', () => {
    const [row] = buildInventoryRows(
      [creature({
        id: 'f3',
        name: '火焰仙',
        scientificName: 'Centropyge loriculus',
        status: 'DEAD',
        diedOn: '2026-05-20',
        causeOfDeath: 'JUMPED',
      })],
      NOW,
    )

    expect(row).toMatchObject({
      title: '火焰仙',
      subtitle: '跳缸 · 05 / 20',
      status: 'DEAD',
      statusLabel: '死亡',
    })
  })

  it('死亡但沒填死因時只顯示日期', () => {
    const [row] = buildInventoryRows(
      [creature({ id: 'f3', name: '火焰仙', status: 'DEAD', diedOn: '2026-05-20' })],
      NOW,
    )

    expect(row?.subtitle).toBe('05 / 20')
  })

  // Given 某隻生物俗名含有數量 / Then 正常顯示含有數量的俗名，不自動將該筆視為多隻生物
  it('俗名含數量時照原樣顯示，同名的兩隻仍是兩列', () => {
    const rows = buildInventoryRows(
      [
        creature({ id: 'a', name: '公子小丑 ×2', addedOn: '2025-09-28' }),
        creature({ id: 'b', name: '公子小丑 ×2', addedOn: '2025-09-28' }),
      ],
      NOW,
    )

    expect(rows).toHaveLength(2)
    expect(rows.map(row => row.title)).toEqual(['公子小丑 ×2', '公子小丑 ×2'])
    expect(rows.map(row => row.id)).toEqual(['a', 'b'])
  })

  it('一隻生物一列，維持傳入的先後順序', () => {
    const rows = buildInventoryRows(
      [
        creature({ id: 'a', name: '藍倒吊' }),
        creature({ id: 'b', name: '公子小丑' }),
        creature({ id: 'c', name: '公子小丑' }),
      ],
      NOW,
    )

    expect(rows.map(row => row.id)).toEqual(['a', 'b', 'c'])
  })
})
