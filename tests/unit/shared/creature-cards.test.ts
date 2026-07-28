import { describe, expect, it } from 'vitest'
import type { CreatureDto } from '../../../shared/types/home'
import {
  CREATURE_CATEGORY_LABELS,
  buildCreatureCards,
  countCreaturesByCategory,
  monthsInTank,
} from '../../../shared/utils/creatureCards'

const NOW = new Date('2026-07-28T09:41:00.000Z')

function creature(overrides: Partial<CreatureDto> & Pick<CreatureDto, 'id' | 'name'>): CreatureDto {
  return {
    category: 'FISH',
    status: 'ALIVE',
    photoUrl: null,
    addedOn: '2025-11-28',
    ailment: null,
    diedOn: null,
    ...overrides,
  }
}

describe('monthsInTank', () => {
  // Then 存活卡片副標為「存活 · N 月」（由 addedOn 推算至今）
  it('存活的生物由 addedOn 推算到今天', () => {
    expect(monthsInTank(creature({ id: 'c1', name: '藍倒吊', addedOn: '2025-11-28' }), NOW)).toBe(8)
  })

  it('還沒滿一個月時算 0 月', () => {
    expect(monthsInTank(creature({ id: 'c1', name: '新魚', addedOn: '2026-07-20' }), NOW)).toBe(0)
  })

  it('未過該月同一日時不進位', () => {
    expect(monthsInTank(creature({ id: 'c1', name: '藍倒吊', addedOn: '2025-11-29' }), NOW)).toBe(7)
  })

  // Then 死亡卡片副標為「死亡 · N 月」（由 addedOn 推算至 diedOn）
  it('已死亡的生物算到 diedOn 而不是今天', () => {
    const dead = creature({
      id: 'c9',
      name: '六線龍',
      status: 'DEAD',
      addedOn: '2025-10-10',
      diedOn: '2026-01-10',
    })

    expect(monthsInTank(dead, NOW)).toBe(3)
  })

  // Prisma 的 @db.Date 一律以 UTC 解讀，結果不因執行機器的時區而位移一天
  it('日期字串以 UTC 解讀', () => {
    const added = creature({ id: 'c1', name: '藍倒吊', addedOn: '2025-11-28T00:00:00.000Z' })

    expect(monthsInTank(added, NOW)).toBe(8)
  })
})

describe('countCreaturesByCategory', () => {
  // Given 該缸有 12 隻生物：魚 5、珊瑚 6、其他 1
  // Then 「生物」標題右側顯示「12 隻」，並有 4 個分類 chip：全部 / 魚 5 / 珊瑚 6 / 其他 1
  it('分別數出總數與三個分類的數量', () => {
    const creatures = [
      ...Array.from({ length: 5 }, (_, i) => creature({ id: `f${i}`, name: `魚${i}`, category: 'FISH' })),
      ...Array.from({ length: 6 }, (_, i) => creature({ id: `c${i}`, name: `珊瑚${i}`, category: 'CORAL' })),
      creature({ id: 'o1', name: '海星', category: 'OTHER' }),
    ]

    expect(countCreaturesByCategory(creatures)).toEqual({
      all: 12,
      FISH: 5,
      CORAL: 6,
      OTHER: 1,
    })
  })

  // 數量算的是「隻數」而不是「卡片數」——同名合併後仍是 2 隻
  it('同名合併不影響隻數', () => {
    const creatures = [
      creature({ id: 'a', name: '公子小丑' }),
      creature({ id: 'b', name: '公子小丑' }),
    ]

    expect(countCreaturesByCategory(creatures).all).toBe(2)
  })

  it('沒有生物時全部為 0', () => {
    expect(countCreaturesByCategory([])).toEqual({ all: 0, FISH: 0, CORAL: 0, OTHER: 0 })
  })
})

describe('buildCreatureCards', () => {
  it('分類標籤為魚 / 珊瑚 / 其他', () => {
    expect(CREATURE_CATEGORY_LABELS).toEqual({ FISH: '魚', CORAL: '珊瑚', OTHER: '其他' })
  })

  // Then 存活卡片副標為「存活 · N 月」
  it('存活卡片的副標為「存活 · N 月」', () => {
    const [card] = buildCreatureCards([creature({ id: 'c1', name: '藍倒吊', addedOn: '2025-11-28' })], NOW)

    expect(card).toMatchObject({ id: 'c1', title: '藍倒吊', count: 1, status: 'ALIVE', subtitle: '存活 · 8 月' })
  })

  // Then 生病卡片副標為「生病 · <症狀>」
  it('生病卡片的副標為「生病 · 症狀」', () => {
    const [card] = buildCreatureCards(
      [creature({ id: 'c2', name: '黃三角', status: 'SICK', ailment: '白點' })],
      NOW,
    )

    expect(card).toMatchObject({ title: '黃三角', status: 'SICK', subtitle: '生病 · 白點' })
  })

  it('生病但沒填症狀時副標退回「生病 · 觀察中」', () => {
    const [card] = buildCreatureCards([creature({ id: 'c2', name: '黃三角', status: 'SICK' })], NOW)

    expect(card?.subtitle).toBe('生病 · 觀察中')
  })

  // Then 死亡卡片副標為「死亡 · N 月」
  it('死亡卡片的副標為「死亡 · N 月」', () => {
    const [card] = buildCreatureCards(
      [creature({ id: 'c9', name: '六線龍', status: 'DEAD', addedOn: '2025-10-10', diedOn: '2026-01-10' })],
      NOW,
    )

    expect(card).toMatchObject({ title: '六線龍', status: 'DEAD', subtitle: '死亡 · 3 月' })
  })

  // Given 該缸有兩隻同名的「公子小丑」/ Then 兩者合併為一張卡片，標題顯示「公子小丑 ×2」
  it('同名同狀態的生物合併成一張卡片並標上 ×N', () => {
    const cards = buildCreatureCards(
      [
        creature({ id: 'a', name: '公子小丑', addedOn: '2025-09-28' }),
        creature({ id: 'b', name: '公子小丑', addedOn: '2026-03-01' }),
      ],
      NOW,
    )

    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ name: '公子小丑', title: '公子小丑 ×2', count: 2 })
  })

  // 卡片以群組中最早建檔的那一隻為代表：月數、照片、點擊後導向的 id 都取自它
  it('合併後的卡片以群組中第一隻為代表', () => {
    const cards = buildCreatureCards(
      [
        creature({ id: 'a', name: '公子小丑', addedOn: '2025-09-28' }),
        creature({ id: 'b', name: '公子小丑', addedOn: '2026-03-01' }),
      ],
      NOW,
    )

    expect(cards[0]).toMatchObject({ id: 'a', subtitle: '存活 · 10 月' })
  })

  // status 是「單一個體」的屬性（schema.prisma 的 Creature 註解），
  // 一隻活著一隻生病合成「×2 存活」會直接說謊，所以狀態不同就不合併。
  it('同名但狀態不同時不合併', () => {
    const cards = buildCreatureCards(
      [
        creature({ id: 'a', name: '公子小丑' }),
        creature({ id: 'b', name: '公子小丑', status: 'SICK', ailment: '白點' }),
      ],
      NOW,
    )

    expect(cards).toHaveLength(2)
    expect(cards.map(card => card.title)).toEqual(['公子小丑', '公子小丑'])
    expect(cards.map(card => card.count)).toEqual([1, 1])
    expect(cards.map(card => card.subtitle)).toEqual(['存活 · 8 月', '生病 · 白點'])
  })

  it('維持傳入的先後順序', () => {
    const cards = buildCreatureCards(
      [
        creature({ id: 'a', name: '藍倒吊' }),
        creature({ id: 'b', name: '榔頭珊瑚', category: 'CORAL' }),
        creature({ id: 'c', name: '火柴頭', category: 'CORAL' }),
      ],
      NOW,
    )

    expect(cards.map(card => card.title)).toEqual(['藍倒吊', '榔頭珊瑚', '火柴頭'])
  })
})
