// @vitest-environment node

import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { NOT_SIGNED_IN, resolveCreatureSuggestions } from '../../../server/utils/authorization'

// 自動完成的個人歷史建議（issue #159）。
//
// 這支 API 是本輪唯一新增的資料讀取路徑，所以它得跟其他每一支一樣先問「你是誰」：
// 未登入回 401，查詢一律以目前 session 的 userId 為根。建議清單看起來人畜無害，
// 但它讀的是真實的生物資料——少了歸屬條件就是把別人輸入過的學名攤在畫面上。

const USER_A = { id: 'user-a' }
const USER_B = { id: 'user-b' }

interface CreatureRow {
  tank: { userId: string, archivedAt: Date | null }
  name: string
  scientificName: string | null
  category: 'FISH' | 'CORAL' | 'OTHER'
  subCategory: string | null
}

const ROWS: CreatureRow[] = [
  { tank: { userId: USER_A.id, archivedAt: null }, name: '公子小丑', scientificName: 'Amphiprion ocellaris', category: 'FISH', subCategory: '小丑' },
  // 同一種養兩隻：學名與細分類都只該出現一次
  { tank: { userId: USER_A.id, archivedAt: null }, name: '公子小丑', scientificName: 'Amphiprion ocellaris', category: 'FISH', subCategory: '小丑' },
  // 同一個學名、不同俗名：俗名合併進同一筆建議
  { tank: { userId: USER_A.id, archivedAt: null }, name: '黑白公子', scientificName: 'amphiprion Ocellaris', category: 'FISH', subCategory: '小丑' },
  { tank: { userId: USER_A.id, archivedAt: null }, name: '我的怪魚', scientificName: 'Nonexistus fictus', category: 'FISH', subCategory: '自訂族群' },
  // 只填了細分類、沒填學名
  { tank: { userId: USER_A.id, archivedAt: null }, name: '無名軟體', scientificName: null, category: 'CORAL', subCategory: '我的軟體' },
  // 空字串與空白不該變成一項「按了沒東西」的建議
  { tank: { userId: USER_A.id, archivedAt: null }, name: '空白測試', scientificName: '   ', category: 'OTHER', subCategory: '' },
  // 別人的資料：查詢帶了歸屬條件才不會出現在下面的斷言裡
  { tank: { userId: USER_B.id, archivedAt: null }, name: '別人的魚', scientificName: 'Secretus alienus', category: 'FISH', subCategory: '別人的族群' },
]

function matches(row: CreatureRow, where: { tank?: { userId?: string, archivedAt?: Date | null } }): boolean {
  const tank = where.tank ?? {}

  if (tank.userId !== undefined && row.tank.userId !== tank.userId) {
    return false
  }

  return !(tank.archivedAt === null && row.tank.archivedAt !== null)
}

function createClient() {
  const findMany = vi.fn(async ({ where }: { where: { tank?: { userId?: string } } }) =>
    ROWS.filter(row => matches(row, where)).map(({ tank: _tank, ...rest }) => rest))

  return { client: { creature: { findMany } } as unknown as PrismaClient, findMany }
}

describe('GET /api/creature-suggestions', () => {
  it('未登入回 401，而且一次查詢都不發', async () => {
    const { client, findMany } = createClient()

    const result = await resolveCreatureSuggestions(client, null)

    expect(result).toEqual({ ok: false, error: NOT_SIGNED_IN })
    expect(findMany).not.toHaveBeenCalled()
  })

  // Given 我過去曾輸入清單中沒有的學名或細分類
  // Then  去重後的歷史值會出現在建議中，且不包含其他使用者的資料
  it('只查目前使用者名下、未封存缸內的生物', async () => {
    const { client, findMany } = createClient()

    await resolveCreatureSuggestions(client, USER_A)

    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany.mock.calls[0]![0].where).toEqual({ tank: { userId: USER_A.id, archivedAt: null } })
  })

  it('學名去重（不分大小寫），俗名合併，並標成 history', async () => {
    const { client } = createClient()

    const result = await resolveCreatureSuggestions(client, USER_A)

    expect(result.ok).toBe(true)

    const species = result.ok ? result.value.species : []
    const ocellaris = species.filter(item => item.scientificName.toLowerCase() === 'amphiprion ocellaris')

    expect(ocellaris).toHaveLength(1)
    expect(ocellaris[0]!.names).toEqual(['公子小丑', '黑白公子'])
    expect(ocellaris[0]!.subCategory).toBe('小丑')
    expect(ocellaris[0]!.source).toBe('history')
    expect(species.map(item => item.scientificName)).toContain('Nonexistus fictus')
  })

  it('細分類依分類去重，空白值不成為建議', async () => {
    const { client } = createClient()

    const result = await resolveCreatureSuggestions(client, USER_A)

    expect(result.ok).toBe(true)

    const subCategories = result.ok ? result.value.subCategories : []

    expect(subCategories).toEqual([
      { subCategory: '小丑', category: 'FISH', source: 'history' },
      { subCategory: '自訂族群', category: 'FISH', source: 'history' },
      { subCategory: '我的軟體', category: 'CORAL', source: 'history' },
    ])
  })

  it('沒有學名的生物不會變成一筆空的學名建議', async () => {
    const { client } = createClient()

    const result = await resolveCreatureSuggestions(client, USER_A)

    expect(result.ok).toBe(true)
    expect(result.ok && result.value.species.every(item => item.scientificName.trim().length > 0)).toBe(true)
  })

  it('拿不到其他使用者輸入過的值', async () => {
    const { client } = createClient()

    const result = await resolveCreatureSuggestions(client, USER_A)

    expect(result.ok).toBe(true)
    expect(result.ok && result.value.species.map(item => item.scientificName)).not.toContain('Secretus alienus')
    expect(result.ok && result.value.subCategories.map(item => item.subCategory)).not.toContain('別人的族群')
  })

  it('換成另一位使用者就換一份建議', async () => {
    const { client } = createClient()

    const result = await resolveCreatureSuggestions(client, USER_B)

    expect(result.ok).toBe(true)
    expect(result.ok && result.value.species.map(item => item.scientificName)).toEqual(['Secretus alienus'])
  })
})
