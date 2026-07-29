import { describe, expect, it } from 'vitest'
import type { CreatureDetailDto } from '#shared/types/creature'
import {
  CREATURE_STATUS_OPTIONS,
  DEATH_CAUSE_OPTIONS,
  daysInTank,
  formatFullDate,
  formatTaxonomy,
  parseCreatureStatusInput,
} from '#shared/utils/creatureDetail'
import { buildCreatureCards } from '#shared/utils/creatureCards'
import { buildInventoryRows } from '#shared/utils/creatureInventory'

// 生物詳情 · 死亡記錄（Epic #1 screen-6，issue #14）的顯示推算與欄位規則。
//
// schema.prisma 的設計原則：畫面上算得出來的東西都不進資料庫，所以
// 「在缸天數 189 天」「入缸日 2025 / 11 / 12」「魚 · 神仙」都在這裡算出來。

function creature(
  overrides: Partial<CreatureDetailDto> = {},
): CreatureDetailDto {
  return {
    id: 'f5',
    name: '火焰仙',
    scientificName: 'Centropyge loriculus',
    category: 'FISH',
    subCategory: '神仙',
    status: 'ALIVE',
    photoUrl: null,
    addedOn: '2025-11-12',
    ailment: null,
    observedSickOn: null,
    diedOn: null,
    causeOfDeath: null,
    deathNote: null,
    ...overrides,
  }
}

describe('formatTaxonomy — 「<分類> · <細分類>」標籤', () => {
  // Then 顯示照片、俗名、學名，以及「<分類> · <細分類>」標籤（如「魚 · 神仙」）
  it('分類與細分類都有時顯示「魚 · 神仙」', () => {
    expect(formatTaxonomy('FISH', '神仙')).toBe('魚 · 神仙')
  })

  // Given 該生物沒有細分類 / Then 標籤只顯示分類本身（如「魚」），不出現多餘的分隔點
  it('沒有細分類時只顯示分類本身，不留下分隔點', () => {
    expect(formatTaxonomy('FISH', null)).toBe('魚')
    expect(formatTaxonomy('FISH', '   ')).toBe('魚')
    expect(formatTaxonomy('CORAL', null)).toBe('珊瑚')
  })
})

describe('formatFullDate — 入缸日', () => {
  // Then 底部顯示「入缸日 2025 / 11 / 12」
  it('YYYY-MM-DD 轉成「2025 / 11 / 12」', () => {
    expect(formatFullDate('2025-11-12')).toBe('2025 / 11 / 12')
  })

  // @db.Date 一律以 UTC 解讀，換一台時區不同的機器不該差一天
  it('個位數的月與日補零', () => {
    expect(formatFullDate('2026-05-06')).toBe('2026 / 05 / 06')
  })
})

describe('daysInTank — 在缸天數', () => {
  // Given 某生物於 2025/11/12 入缸、於 05/20 死亡
  // Then 顯示「在缸天數 189 天」，天數由入缸日算到死亡日
  it('已死亡的算到死亡日', () => {
    const days = daysInTank(
      creature({ status: 'DEAD', addedOn: '2025-11-12', diedOn: '2026-05-20' }),
      new Date('2026-07-29T09:41:00.000Z'),
    )

    expect(days).toBe(189)
  })

  // Given 某生物仍存活 / Then 「在缸天數」由入缸日算到今天
  it('仍存活的算到今天', () => {
    const days = daysInTank(
      creature({ addedOn: '2026-07-01' }),
      new Date('2026-07-29T09:41:00.000Z'),
    )

    expect(days).toBe(28)
  })

  // And 每天自動增加（不是儲存下來的固定值）——同一筆資料換一天問就多一天
  it('同一筆存活資料，隔天問會多一天', () => {
    const alive = creature({ addedOn: '2026-07-01' })

    expect(daysInTank(alive, new Date('2026-07-29T23:59:59.000Z'))).toBe(28)
    expect(daysInTank(alive, new Date('2026-07-30T00:00:01.000Z'))).toBe(29)
  })

  // 死亡的則不動：同一筆資料換一天問仍是同一個數字
  it('已死亡的天數不隨今天改變', () => {
    const dead = creature({ status: 'DEAD', addedOn: '2025-11-12', diedOn: '2026-05-20' })

    expect(daysInTank(dead, new Date('2026-05-21T00:00:00.000Z'))).toBe(189)
    expect(daysInTank(dead, new Date('2027-01-01T00:00:00.000Z'))).toBe(189)
  })

  it('入缸當天是 0 天', () => {
    expect(daysInTank(creature({ addedOn: '2026-07-29' }), new Date('2026-07-29T09:41:00.000Z'))).toBe(0)
  })
})

describe('狀態與死因的選項', () => {
  // Then 「狀態」區顯示三個互斥選項：存活 / 生病 / 死亡
  it('狀態有三個選項，順序為存活 / 生病 / 死亡', () => {
    expect(CREATURE_STATUS_OPTIONS.map(option => option.key)).toEqual(['ALIVE', 'SICK', 'DEAD'])
    expect(CREATURE_STATUS_OPTIONS.map(option => option.label)).toEqual(['存活', '生病', '死亡'])
  })

  // Then 死亡記錄區包含死因六選一；文字對照表取自 schema.prisma 的 enum 註解
  it('死因六選一，順序與文字對照 schema 的 enum', () => {
    expect(DEATH_CAUSE_OPTIONS).toEqual([
      { key: 'DISEASE', label: '生病' },
      { key: 'WATER_QUALITY', label: '水質變化' },
      { key: 'PREDATION', label: '被獵食 / 打架' },
      { key: 'JUMPED', label: '跳缸' },
      { key: 'STARVATION', label: '餓死（不開口）' },
      { key: 'UNKNOWN', label: '原因不明' },
    ])
  })
})

const ADDED = { addedOn: '2025-11-12' }

describe('parseCreatureStatusInput — 死亡', () => {
  // When 我選擇死因「跳缸」、填入死亡日並儲存
  // Then 該生物狀態變為死亡，死因與死亡日被保存
  it('收下死亡日、死因、發病日與備註', () => {
    const result = parseCreatureStatusInput({
      status: 'DEAD',
      observedSickOn: '2026-05-16',
      ailment: '白點',
      diedOn: '2026-05-20',
      causeOfDeath: 'JUMPED',
      deathNote: '  半夜跳出主缸，早上發現已乾。  ',
    }, ADDED)

    expect(result).toEqual({
      ok: true,
      value: {
        status: 'DEAD',
        observedSickOn: '2026-05-16',
        ailment: '白點',
        diedOn: '2026-05-20',
        causeOfDeath: 'JUMPED',
        deathNote: '半夜跳出主缸，早上發現已乾。',
      },
    })
  })

  // Given 我選擇狀態為「死亡」但未填死亡日 / When 我嘗試儲存
  // Then 顯示驗證錯誤，儲存被阻擋
  it('沒填死亡日時被擋下', () => {
    const result = parseCreatureStatusInput({ status: 'DEAD', diedOn: '' }, ADDED)

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('死亡日')
  })

  // 死因是選填（六個選項之外沒有「未選」以外的值）
  it('沒選死因仍可儲存，死因為 null', () => {
    const result = parseCreatureStatusInput({ status: 'DEAD', diedOn: '2026-05-20' }, ADDED)

    expect(result).toEqual({
      ok: true,
      value: {
        status: 'DEAD',
        observedSickOn: null,
        ailment: null,
        diedOn: '2026-05-20',
        causeOfDeath: null,
        deathNote: null,
      },
    })
  })

  it('死因不在六個選項內時被擋下', () => {
    const result = parseCreatureStatusInput(
      { status: 'DEAD', diedOn: '2026-05-20', causeOfDeath: 'EATEN_BY_CAT' },
      ADDED,
    )

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('死因')
  })
})

describe('parseCreatureStatusInput — 日期先後', () => {
  // Given 我填入的死亡日早於入缸日 / When 我嘗試儲存 / Then 顯示日期先後順序的驗證錯誤
  it('死亡日早於入缸日時被擋下', () => {
    const result = parseCreatureStatusInput({ status: 'DEAD', diedOn: '2025-11-11' }, ADDED)

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('死亡日不能早於入缸日')
  })

  it('死亡日與入缸日同一天可以儲存（當天入缸當天死）', () => {
    const result = parseCreatureStatusInput({ status: 'DEAD', diedOn: '2025-11-12' }, ADDED)

    expect(result.ok).toBe(true)
  })

  // Given 發病日晚於死亡日 / When 我嘗試儲存 / Then 顯示日期先後順序的驗證錯誤
  it('發病日晚於死亡日時被擋下', () => {
    const result = parseCreatureStatusInput(
      { status: 'DEAD', diedOn: '2026-05-20', observedSickOn: '2026-05-21' },
      ADDED,
    )

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('發病日不能晚於死亡日')
  })

  it('發病日早於入缸日時被擋下', () => {
    const result = parseCreatureStatusInput(
      { status: 'SICK', observedSickOn: '2025-11-11' },
      ADDED,
    )

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('發病日不能早於入缸日')
  })

  it('不存在的日期被擋下', () => {
    const result = parseCreatureStatusInput({ status: 'DEAD', diedOn: '2026-02-30' }, ADDED)

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('死亡日')
  })
})

describe('parseCreatureStatusInput — 生病', () => {
  // Given 我把狀態切為「生病」/ Then 顯示發病日與症狀欄位（不要求死亡日與死因）
  it('生病只需要發病日與症狀，不要求死亡日', () => {
    const result = parseCreatureStatusInput(
      { status: 'SICK', observedSickOn: '2026-07-26', ailment: ' 白點 ' },
      ADDED,
    )

    expect(result).toEqual({
      ok: true,
      value: {
        status: 'SICK',
        observedSickOn: '2026-07-26',
        ailment: '白點',
        diedOn: null,
        causeOfDeath: null,
        deathNote: null,
      },
    })
  })

  // 從死亡改回生病：死亡記錄的三個欄位一併清掉，發病日（兩者共用）留著
  it('從死亡改成生病時清掉死亡日 / 死因 / 死亡備註', () => {
    const result = parseCreatureStatusInput({
      status: 'SICK',
      observedSickOn: '2026-05-16',
      ailment: '白點',
      diedOn: '2026-05-20',
      causeOfDeath: 'JUMPED',
      deathNote: '半夜跳出主缸',
    }, ADDED)

    expect(result.ok === true && result.value).toMatchObject({
      status: 'SICK',
      observedSickOn: '2026-05-16',
      diedOn: null,
      causeOfDeath: null,
      deathNote: null,
    })
  })
})

describe('parseCreatureStatusInput — 改回存活', () => {
  // Given 我把一隻已標記死亡的生物改回「存活」/ When 我儲存
  // Then 死亡相關資料（死亡日 / 死因 / 死亡備註）被清除，狀態回到存活
  it('改回存活時清除死亡日 / 死因 / 死亡備註', () => {
    const result = parseCreatureStatusInput({
      status: 'ALIVE',
      observedSickOn: '2026-05-16',
      ailment: '白點',
      diedOn: '2026-05-20',
      causeOfDeath: 'JUMPED',
      deathNote: '半夜跳出主缸',
    }, ADDED)

    expect(result).toEqual({
      ok: true,
      value: {
        status: 'ALIVE',
        // 發病日與症狀同樣清掉：牠現在是活的，留著會讓庫存列表繼續說牠「觀察第 N 天」
        observedSickOn: null,
        ailment: null,
        diedOn: null,
        causeOfDeath: null,
        deathNote: null,
      },
    })
  })

  // 改回存活時連日期先後都不必檢查——那些欄位反正要被清掉
  it('改回存活時，原本不合先後順序的日期不會擋住儲存', () => {
    const result = parseCreatureStatusInput(
      { status: 'ALIVE', diedOn: '2020-01-01', observedSickOn: '2030-01-01' },
      ADDED,
    )

    expect(result.ok).toBe(true)
  })
})

describe('parseCreatureStatusInput — 不合法的輸入', () => {
  it('狀態不是三選一時被擋下', () => {
    const result = parseCreatureStatusInput({ status: 'ZOMBIE' }, ADDED)

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('狀態')
  })

  it('完全不是物件時被擋下', () => {
    expect(parseCreatureStatusInput(null, ADDED).ok).toBe(false)
  })

  it('症狀過長時被擋下', () => {
    const result = parseCreatureStatusInput(
      { status: 'SICK', ailment: '白'.repeat(41) },
      ADDED,
    )

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('症狀')
  })

  it('備註過長時被擋下', () => {
    const result = parseCreatureStatusInput(
      { status: 'DEAD', diedOn: '2026-05-20', deathNote: '跳'.repeat(501) },
      ADDED,
    )

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('備註')
  })
})

// Then 該生物在首頁卡片顯示「⚠ 觀察中」與「生病 · <症狀>」，
//      在庫存列表顯示「<症狀> · 觀察第 N 天」
//
// 兩張畫面的字串由既有的 shared/utils（issue #9 / #13）產生，這裡驗證
// 「本頁存下去的資料」餵進那兩支之後，說出來的正是驗收條件要求的那兩句。
describe('存成生病之後，首頁與庫存列表說的話', () => {
  const NOW = new Date('2026-07-29T09:41:00.000Z')

  const saved = creature({
    status: 'SICK',
    observedSickOn: '2026-07-26',
    ailment: '白點',
  })

  it('首頁卡片副標為「生病 · 白點」，並帶有生病狀態（卡片據此顯示「⚠ 觀察中」）', () => {
    const [card] = buildCreatureCards([saved], NOW)

    expect(card?.status).toBe('SICK')
    expect(card?.subtitle).toBe('生病 · 白點')
  })

  it('庫存列表第二行為「白點 · 觀察第 3 天」', () => {
    const [row] = buildInventoryRows([saved], NOW)

    expect(row?.subtitle).toBe('白點 · 觀察第 3 天')
  })
})
