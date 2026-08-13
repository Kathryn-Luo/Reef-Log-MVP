import type { PrismaClient } from '@prisma/client'
import type {
  CreatureSpeciesSuggestion,
  CreatureSubCategorySuggestion,
  CreatureSuggestionsResponse,
} from '#shared/types/creature'

// 自動完成的個人歷史建議（issue #159）。
//
// 內建物種清單（shared/utils/creatureSpecies.ts）解的是「新使用者沒有東西可選」，
// 這一支解的是另一半：清單裡沒有、但這位使用者自己輸入過的寫法。兩份在瀏覽器端
// 合併，歷史值優先——那是他實際打過的字。
//
// Prisma Client 由呼叫端傳入，與 creatureList.ts 同一個作法：函式因此能在完全
// 連不到資料庫的情況下用假 client 測試。
//
// ⚠ 歸屬條件寫在這支查詢裡，不是「呼叫之前已經檢查過了」。建議清單看起來人畜無害，
// 但它讀的是真實的生物資料——少了 `tank: { userId }` 就是把別人輸入過的學名攤在畫面上。
// 一併排除已封存的缸，與 authorization.ts 的 ownsTank 同一組條件。

/** 去重的鍵：使用者不會記得自己上次打的是大寫還是小寫 */
function normalize(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * 這位使用者過去輸入過的學名與細分類，各自去重。
 *
 * 順序是「最近建立的生物在前」：最近寫過的寫法通常也是接下來要用的。
 */
export async function getCreatureSuggestions(
  client: PrismaClient,
  userId: string,
): Promise<CreatureSuggestionsResponse> {
  const creatures = await client.creature.findMany({
    where: { tank: { userId, archivedAt: null } },
    select: { name: true, scientificName: true, category: true, subCategory: true },
    orderBy: { createdAt: 'desc' },
  })

  const species = new Map<string, CreatureSpeciesSuggestion>()
  const subCategories = new Map<string, CreatureSubCategorySuggestion>()

  for (const creature of creatures) {
    const scientificName = creature.scientificName?.trim() ?? ''
    const subCategory = creature.subCategory?.trim() ?? ''
    const name = creature.name.trim()

    if (scientificName) {
      const key = normalize(scientificName)
      const existing = species.get(key)

      if (existing) {
        // 同一個學名養過好幾隻：俗名合併成一份，畫面上仍看得出「這是我的哪一隻」。
        // 細分類則補上第一個非空值——先建立的那一隻可能根本沒填。
        if (name && !existing.names.includes(name)) {
          existing.names.push(name)
        }

        existing.subCategory ??= subCategory || null
      }
      else {
        species.set(key, {
          names: name ? [name] : [],
          scientificName,
          category: creature.category,
          subCategory: subCategory || null,
          source: 'history',
        })
      }
    }

    // 空字串與只有空白的值不成為建議：那是一項按了什麼也不會發生的選項
    if (subCategory) {
      const key = `${creature.category}\n${normalize(subCategory)}`

      if (!subCategories.has(key)) {
        subCategories.set(key, { subCategory, category: creature.category, source: 'history' })
      }
    }
  }

  return {
    species: [...species.values()],
    subCategories: [...subCategories.values()],
  }
}
