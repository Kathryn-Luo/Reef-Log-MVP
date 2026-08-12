// @vitest-environment node
// 純資料與純函式，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import type { CreatureSpeciesSuggestion, CreatureSubCategorySuggestion } from '#shared/types/creature'
import { describe, expect, it } from 'vitest'
import { parseCreatureProfileInput } from '../../../shared/utils/creatureForm'
import {
  CREATURE_SPECIES,
  searchSpeciesSuggestions,
  searchSubCategorySuggestions,
} from '../../../shared/utils/creatureSpecies'

// 內建物種清單與兩個欄位的建議來源（issue #159）。
//
// 這一層是「輸入輔助」的規則本身：哪些字串會命中哪一筆、歷史值怎麼與內建清單合併、
// 細分類怎麼依分類篩選。全部是純函式，所以頁面那一層（creature-suggest.test.ts）
// 只需要驗「有沒有接上、選了會發生什麼」，不必把比對規則再驗一次。

const HISTORY_SPECIES: CreatureSpeciesSuggestion[] = [
  {
    names: ['公子小丑'],
    scientificName: 'Amphiprion ocellaris',
    category: 'FISH',
    subCategory: '小丑',
    source: 'history',
  },
  {
    names: ['我的怪魚'],
    scientificName: 'Nonexistus fictus',
    category: 'FISH',
    subCategory: '自訂族群',
    source: 'history',
  },
]

const HISTORY_SUB_CATEGORIES: CreatureSubCategorySuggestion[] = [
  { subCategory: '自訂族群', category: 'FISH', source: 'history' },
  { subCategory: '我的軟體', category: 'CORAL', source: 'history' },
]

describe('內建物種清單', () => {
  it('每一筆都有俗名、學名、分類與細分類', () => {
    expect(CREATURE_SPECIES.length).toBeGreaterThan(0)

    for (const species of CREATURE_SPECIES) {
      expect(species.names.length).toBeGreaterThan(0)
      expect(species.names.every(name => name.trim().length > 0)).toBe(true)
      expect(species.scientificName.trim().length).toBeGreaterThan(0)
      expect(['FISH', 'CORAL', 'OTHER']).toContain(species.category)
      expect(species.subCategory.trim().length).toBeGreaterThan(0)
    }
  })

  it('涵蓋示範資料裡的物種，新使用者一開始就有東西可選', () => {
    const scientificNames = CREATURE_SPECIES.map(species => species.scientificName)

    expect(scientificNames).toContain('Centropyge loriculus')
    expect(scientificNames).toContain('Euphyllia ancora')
    expect(scientificNames).toContain('Lysmata amboinensis')
  })
})

// Given 我尚未建立任何生物
// When  我在學名欄輸入俗名、別名或部分學名
// Then  顯示符合內建物種清單的建議，且可選取其中一項
describe('學名欄的建議：俗名、別名、學名都搜得到', () => {
  it('以俗名搜尋得到該物種的學名與細分類', () => {
    const results = searchSpeciesSuggestions({ query: '火焰仙' })

    expect(results.some(item => item.scientificName === 'Centropyge loriculus')).toBe(true)
    expect(results.find(item => item.scientificName === 'Centropyge loriculus')?.subCategory).toBe('神仙')
  })

  it('以別名搜尋得到同一筆', () => {
    const byAlias = searchSpeciesSuggestions({ query: '火焰神仙' })

    expect(byAlias.some(item => item.scientificName === 'Centropyge loriculus')).toBe(true)
  })

  it('以部分學名搜尋，且不分大小寫', () => {
    const lower = searchSpeciesSuggestions({ query: 'centropyge' })
    const upper = searchSpeciesSuggestions({ query: 'CENTROPYGE LORI' })

    expect(lower.some(item => item.scientificName === 'Centropyge loriculus')).toBe(true)
    expect(upper.some(item => item.scientificName === 'Centropyge loriculus')).toBe(true)
  })

  it('內建建議標成 builtin，帶得出俗名清單', () => {
    const [first] = searchSpeciesSuggestions({ query: 'Euphyllia ancora' })

    expect(first?.source).toBe('builtin')
    expect(first?.names).toContain('榔頭珊瑚')
  })

  it('沒有輸入時不主動列出整份清單', () => {
    expect(searchSpeciesSuggestions({ query: '' })).toEqual([])
    expect(searchSpeciesSuggestions({ query: '   ' })).toEqual([])
  })

  it('完全對不上的字串不硬湊建議', () => {
    expect(searchSpeciesSuggestions({ query: 'zzzz 不存在的東西' })).toEqual([])
  })

  it('建議筆數有上限，不會把整份清單倒進畫面', () => {
    expect(searchSpeciesSuggestions({ query: 'a', limit: 3 }).length).toBeLessThanOrEqual(3)
  })
})

// Given 我過去曾輸入清單中沒有的學名或細分類
// When  我再次新增或編輯自己名下的生物
// Then  去重後的歷史值會出現在建議中
describe('學名欄的建議：個人歷史值', () => {
  it('清單裡沒有的歷史學名也搜得到', () => {
    const results = searchSpeciesSuggestions({ query: '怪魚', history: HISTORY_SPECIES })

    expect(results.map(item => item.scientificName)).toContain('Nonexistus fictus')
    expect(results.find(item => item.scientificName === 'Nonexistus fictus')?.source).toBe('history')
  })

  it('與內建清單重複的學名只出現一次，並以歷史值優先', () => {
    const results = searchSpeciesSuggestions({ query: '小丑', history: HISTORY_SPECIES })
    const matched = results.filter(item => item.scientificName === 'Amphiprion ocellaris')

    expect(matched).toHaveLength(1)
    expect(matched[0]!.source).toBe('history')
  })

  it('去重不分大小寫', () => {
    const history: CreatureSpeciesSuggestion[] = [
      { ...HISTORY_SPECIES[0]!, scientificName: 'amphiprion OCELLARIS' },
    ]
    const results = searchSpeciesSuggestions({ query: 'ocellaris', history })

    expect(results.filter(item => item.scientificName.toLowerCase() === 'amphiprion ocellaris')).toHaveLength(1)
  })
})

// Given 我已選擇生物分類
// When  我開啟或輸入細分類欄位
// Then  只優先顯示符合該分類的內建與個人歷史建議
describe('細分類的建議依分類篩選', () => {
  it('選了魚就只出現魚的細分類', () => {
    const results = searchSubCategorySuggestions({ category: 'FISH', history: HISTORY_SUB_CATEGORIES })

    expect(results.length).toBeGreaterThan(0)
    expect(results.every(item => item.category === 'FISH')).toBe(true)
    expect(results.map(item => item.subCategory)).toContain('神仙')
    expect(results.map(item => item.subCategory)).not.toContain('LPS')
    expect(results.map(item => item.subCategory)).not.toContain('我的軟體')
  })

  it('改選珊瑚後建議跟著換一批', () => {
    const results = searchSubCategorySuggestions({ category: 'CORAL', history: HISTORY_SUB_CATEGORIES })

    expect(results.every(item => item.category === 'CORAL')).toBe(true)
    expect(results.map(item => item.subCategory)).toContain('LPS')
    expect(results.map(item => item.subCategory)).toContain('我的軟體')
    expect(results.map(item => item.subCategory)).not.toContain('神仙')
  })

  // 三類各取一個代表值，確認沒有任何一類被關在門外。
  // 不斷言「不帶 query 的前幾筆涵蓋三類」——那驗到的是顯示上限的排序，不是分類篩選。
  it('還沒選分類時三類都可以選', () => {
    expect(searchSubCategorySuggestions({ query: '神仙', category: '' }).map(item => item.category)).toEqual(['FISH'])
    expect(searchSubCategorySuggestions({ query: 'lps', category: '' }).map(item => item.category)).toEqual(['CORAL'])
    expect(searchSubCategorySuggestions({ query: '海星', category: '' }).map(item => item.category)).toEqual(['OTHER'])
  })

  it('開啟欄位（尚未輸入）就給得出該分類的建議', () => {
    expect(searchSubCategorySuggestions({ query: '', category: 'CORAL' }).length).toBeGreaterThan(0)
  })

  it('輸入後再篩一次，且不分大小寫', () => {
    const results = searchSubCategorySuggestions({ query: 'lp', category: 'CORAL' })

    expect(results.map(item => item.subCategory)).toEqual(['LPS'])
  })

  it('歷史細分類排在內建之前，重複的只留一筆', () => {
    const history: CreatureSubCategorySuggestion[] = [
      { subCategory: '神仙', category: 'FISH', source: 'history' },
    ]
    const results = searchSubCategorySuggestions({ query: '神仙', category: 'FISH', history })

    expect(results).toHaveLength(1)
    expect(results[0]!.source).toBe('history')
  })
})

// Given 我要輸入建議清單中不存在的值
// When  我直接完成輸入並儲存
// Then  表單接受該自由文字，既有的 trim、選填與 API 驗證行為維持不變
describe('清單只是輔助，不限制寫入', () => {
  const NOW = new Date('2026-08-12T00:00:00.000Z')

  it('清單外的學名與細分類仍然通過既有的表單規則', () => {
    const parsed = parseCreatureProfileInput({
      name: '沒人聽過的魚',
      scientificName: '  Ignotus piscis  ',
      category: 'FISH',
      subCategory: '  我自己分的類  ',
      addedOn: '2026-08-01',
      price: '',
      timeZoneOffsetMinutes: -480,
    }, NOW)

    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.value.scientificName).toBe('Ignotus piscis')
    expect(parsed.ok && parsed.value.subCategory).toBe('我自己分的類')
  })

  it('兩個欄位仍然是選填', () => {
    const parsed = parseCreatureProfileInput({
      name: '沒學名的魚',
      category: 'OTHER',
      addedOn: '2026-08-01',
      timeZoneOffsetMinutes: -480,
    }, NOW)

    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.value.scientificName).toBeNull()
    expect(parsed.ok && parsed.value.subCategory).toBeNull()
  })
})
