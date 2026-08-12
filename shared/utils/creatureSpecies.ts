import type { CreatureCategoryKey } from '../types/home'
import type { CreatureSpeciesSuggestion, CreatureSubCategorySuggestion } from '../types/creature'

// 內建物種清單與兩個欄位的建議規則（issue #159）。
//
// 為什麼資料放在 repo 裡而不是打外部物種 API：中文俗名在國際資料庫裡幾乎查不到，
// 而這兩個欄位要幫的正是「我只知道牠叫火焰仙」的人。網路失敗與第三方分類異動也
// 不該讓一個純輸入輔助的欄位卡住表單（issue 的產品決定第 6 條）。
//
// 這份清單是**建議**，不是白名單：欄位仍是自由字串，清單外的值照樣存得進去。
// 因此這裡不做任何「不在清單就拒絕」的判斷，parseCreatureProfileInput 也一個字都不必改。
//
// 規則住在 shared/ 的理由與 creatureForm.ts 一致：搜尋只在瀏覽器端跑，但型別與
// 資料要能被 server 的歷史建議共用（兩邊產出的是同一種 CreatureSpeciesSuggestion）。

export interface CreatureSpecies {
  /** 俗名與別名，第一個作為建議清單的主標 */
  names: readonly string[]
  scientificName: string
  category: CreatureCategoryKey
  subCategory: string
}

/** 建議清單一次最多顯示幾筆。太長的清單在手機上會蓋掉整個表單。 */
export const CREATURE_SUGGESTION_LIMIT = 8

/**
 * ReefLog 的內建物種清單。
 *
 * 第一版由 prisma/seed.ts 的 12 隻示範生物延伸，補上專案畫面與示範資料周邊
 * 常見的海水魚、珊瑚與無脊椎生物。新使用者因此在完全沒有歷史資料時就有東西可選。
 *
 * 別名（names 的第二個之後）收的是台灣魚友實際會打出來的寫法，例如
 * 「火焰仙 / 火焰神仙」「藍倒吊 / 藍吊」——搜尋命中的機會幾乎都在這些字上。
 */
export const CREATURE_SPECIES: readonly CreatureSpecies[] = [
  // ── 魚 ──
  { names: ['藍倒吊', '藍吊', '藍刀吊'], scientificName: 'Paracanthurus hepatus', category: 'FISH', subCategory: '倒吊' },
  { names: ['黃三角倒吊', '黃吊', '黃三角'], scientificName: 'Zebrasoma flavescens', category: 'FISH', subCategory: '倒吊' },
  { names: ['白面倒吊', '白面吊'], scientificName: 'Acanthurus japonicus', category: 'FISH', subCategory: '倒吊' },
  { names: ['公子小丑', '小丑魚', '公子'], scientificName: 'Amphiprion ocellaris', category: 'FISH', subCategory: '小丑' },
  { names: ['咖啡小丑', '克氏小丑'], scientificName: 'Amphiprion clarkii', category: 'FISH', subCategory: '小丑' },
  { names: ['火焰仙', '火焰神仙'], scientificName: 'Centropyge loriculus', category: 'FISH', subCategory: '神仙' },
  { names: ['黃新娘', '黃新娘神仙'], scientificName: 'Centropyge heraldi', category: 'FISH', subCategory: '神仙' },
  { names: ['皇后神仙', '皇后'], scientificName: 'Pomacanthus imperator', category: 'FISH', subCategory: '神仙' },
  { names: ['六線龍', '六線龍魚'], scientificName: 'Pseudocheilinus hexataenia', category: 'FISH', subCategory: '龍魚' },
  // 曼德琳是䲗科（Callionymidae），不是鰕虎科——外型像、分類上不是同一群
  { names: ['青蛙', '青蛙魚', '花斑連鰭䲗', '曼德琳'], scientificName: 'Synchiropus splendidus', category: 'FISH', subCategory: '青蛙魚' },
  { names: ['火箭', '雷達', '紅火箭'], scientificName: 'Nemateleotris magnifica', category: 'FISH', subCategory: '鰕虎' },
  { names: ['黃金鰕虎', '黃金蝦虎'], scientificName: 'Cryptocentrus cinctus', category: 'FISH', subCategory: '鰕虎' },
  { names: ['藍魔鬼', '藍雀'], scientificName: 'Chrysiptera cyanea', category: 'FISH', subCategory: '雀鯛' },
  { names: ['黃尾藍魔', '曙光雀鯛'], scientificName: 'Chrysiptera parasema', category: 'FISH', subCategory: '雀鯛' },
  { names: ['紅蘋果', '蘋果鷹'], scientificName: 'Neocirrhites armatus', category: 'FISH', subCategory: '鷹魚' },
  { names: ['小丑砲彈', '花斑擬鱗魨'], scientificName: 'Balistoides conspicillum', category: 'FISH', subCategory: '砲彈' },

  // ── 珊瑚 ──
  { names: ['榔頭珊瑚', '鎚頭珊瑚', '槌頭'], scientificName: 'Euphyllia ancora', category: 'CORAL', subCategory: 'LPS' },
  { names: ['火炬珊瑚', '火把'], scientificName: 'Euphyllia glabrescens', category: 'CORAL', subCategory: 'LPS' },
  { names: ['太陽花珊瑚', '千手'], scientificName: 'Goniopora sp.', category: 'CORAL', subCategory: 'LPS' },
  { names: ['泡泡珊瑚', '泡泡'], scientificName: 'Plerogyra sinuosa', category: 'CORAL', subCategory: 'LPS' },
  { names: ['腦珊瑚', '開放腦'], scientificName: 'Trachyphyllia geoffroyi', category: 'CORAL', subCategory: 'LPS' },
  { names: ['鹿角珊瑚', '軸孔珊瑚'], scientificName: 'Acropora sp.', category: 'CORAL', subCategory: 'SPS' },
  { names: ['鳥巢珊瑚', '鳥巢'], scientificName: 'Seriatopora hystrix', category: 'CORAL', subCategory: 'SPS' },
  { names: ['木耳珊瑚', '板片'], scientificName: 'Montipora sp.', category: 'CORAL', subCategory: 'SPS' },
  { names: ['紐扣珊瑚', '鈕扣', '千手佛'], scientificName: 'Zoanthus sp.', category: 'CORAL', subCategory: '軟體' },
  { names: ['皮革軟珊瑚', '皮革'], scientificName: 'Sarcophyton sp.', category: 'CORAL', subCategory: '軟體' },
  { names: ['蘑菇珊瑚', '香菇'], scientificName: 'Discosoma sp.', category: 'CORAL', subCategory: '軟體' },

  // ── 其他 ──
  { names: ['白襪清潔蝦', '清潔蝦', '白襪蝦'], scientificName: 'Lysmata amboinensis', category: 'OTHER', subCategory: '蝦' },
  { names: ['火焰蝦', '紅蘇蝦'], scientificName: 'Lysmata debelius', category: 'OTHER', subCategory: '蝦' },
  { names: ['翡翠蟹', '綠翡翠蟹'], scientificName: 'Mithraculus sculptus', category: 'OTHER', subCategory: '蟹' },
  { names: ['藍腳寄居蟹', '寄居蟹'], scientificName: 'Calcinus elegans', category: 'OTHER', subCategory: '寄居蟹' },
  // 蠑螺是 Turbo 屬；Trochus 是馬蹄螺／鐘螺，兩者在缸裡都常見但不是同一種，分開列
  { names: ['蠑螺', '角螺'], scientificName: 'Turbo sp.', category: 'OTHER', subCategory: '螺' },
  { names: ['馬蹄螺', '鐘螺'], scientificName: 'Trochus sp.', category: 'OTHER', subCategory: '螺' },
  { names: ['藍指海星', '海星'], scientificName: 'Linckia laevigata', category: 'OTHER', subCategory: '海星' },
  { names: ['奶嘴海葵', '泡泡海葵'], scientificName: 'Entacmaea quadricolor', category: 'OTHER', subCategory: '海葵' },
]

/** 比對一律走小寫並去掉頭尾空白：使用者不會記得學名的大小寫。 */
function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function toSuggestion(species: CreatureSpecies): CreatureSpeciesSuggestion {
  return {
    names: [...species.names],
    scientificName: species.scientificName,
    category: species.category,
    subCategory: species.subCategory,
    source: 'builtin',
  }
}

/** 學名（正規化後）→ 內建清單那一筆。合併歷史值時要查它。 */
const BUILTIN_BY_SCIENTIFIC_NAME = new Map(
  CREATURE_SPECIES.map(species => [normalize(species.scientificName), species]),
)

/**
 * 把內建清單已知、而歷史值缺少的欄位補進歷史值。
 *
 * 「歷史值優先」決定的是**顯示哪一份**——留下使用者自己寫過的學名大小寫與他給那隻
 * 生物取的名字。但它不該把內建清單知道的事情一起丟掉：上次填了學名卻把細分類留白的
 * 使用者，下次選同一筆建議時就再也帶不進細分類了（PR #177 的 review）。
 *
 * 俗名接在使用者自己的名字後面，所以主標仍是「小火」而不是「火焰仙」，
 * 但打「火焰仙」時這一筆也搜得到——使用者記得的通常是俗名，不是學名。
 */
function withBuiltinFallback(suggestion: CreatureSpeciesSuggestion): CreatureSpeciesSuggestion {
  const builtin = BUILTIN_BY_SCIENTIFIC_NAME.get(normalize(suggestion.scientificName))

  if (!builtin) {
    return suggestion
  }

  const extraNames = builtin.names.filter(name => !suggestion.names.includes(name))

  return {
    ...suggestion,
    names: extraNames.length ? [...suggestion.names, ...extraNames] : suggestion.names,
    subCategory: suggestion.subCategory ?? builtin.subCategory,
  }
}

/** 俗名、別名、學名任何一個含有輸入字串就算命中 */
function matchesSpecies(suggestion: CreatureSpeciesSuggestion, query: string): boolean {
  return normalize(suggestion.scientificName).includes(query)
    || suggestion.names.some(name => normalize(name).includes(query))
}

export interface SearchSpeciesOptions {
  /** 學名欄當下的輸入。使用者可能打的是俗名，所以它不必長得像學名。 */
  query: string
  /** 這位使用者過去輸入過的學名（GET /api/creature-suggestions） */
  history?: readonly CreatureSpeciesSuggestion[]
  limit?: number
}

/**
 * 學名欄的建議：個人歷史值優先，其次內建清單，依學名去重。
 *
 * 沒有輸入時回空陣列——這一欄不像細分類只有十來種寫法，開啟欄位就倒出整份清單
 * 只會擋住表單。細分類的規則因此不同，見 searchSubCategorySuggestions。
 */
export function searchSpeciesSuggestions(options: SearchSpeciesOptions): CreatureSpeciesSuggestion[] {
  const query = normalize(options.query)

  if (!query) {
    return []
  }

  const limit = options.limit ?? CREATURE_SUGGESTION_LIMIT
  const seen = new Set<string>()
  const results: CreatureSpeciesSuggestion[] = []

  // 歷史在前：同一個學名兩邊都有時，留下的是這位使用者自己寫過的那一份，
  // 但缺的欄位先由內建清單補齊（見 withBuiltinFallback）
  const candidates = [
    ...(options.history ?? []).map(withBuiltinFallback),
    ...CREATURE_SPECIES.map(toSuggestion),
  ]

  for (const suggestion of candidates) {
    const key = normalize(suggestion.scientificName)

    if (!key || seen.has(key) || !matchesSpecies(suggestion, query)) {
      continue
    }

    seen.add(key)
    results.push(suggestion)

    if (results.length >= limit) {
      break
    }
  }

  return results
}

export interface SearchSubCategoryOptions {
  /** 細分類欄當下的輸入。空白代表「剛開啟欄位」，此時列出該分類的全部建議。 */
  query?: string
  /** 目前選到的分類；`''` 代表還沒選，此時三類都可以看到 */
  category?: CreatureCategoryKey | ''
  history?: readonly CreatureSubCategorySuggestion[]
  limit?: number
}

/** 內建清單的細分類（依清單順序，去重） */
function builtinSubCategories(): CreatureSubCategorySuggestion[] {
  const seen = new Set<string>()

  return CREATURE_SPECIES.flatMap((species) => {
    const key = `${species.category}\n${normalize(species.subCategory)}`

    if (seen.has(key)) {
      return []
    }

    seen.add(key)

    return [{ subCategory: species.subCategory, category: species.category, source: 'builtin' as const }]
  })
}

/**
 * 還沒選分類時，把三類交錯排開（魚、珊瑚、其他、魚、珊瑚…）。
 *
 * 內建清單是照分類分段寫的，直接照順序取的話前 8 筆全是魚——選了分類的人不受影響
 * （後面會篩掉別類），但**還沒選分類**的人會以為這個欄位只認得魚（PR #177 的 review）。
 *
 * 只影響「沒有輸入」時的預設清單順序；一旦開始打字，命中的本來就散落在三類裡。
 */
function interleaveByCategory(items: CreatureSubCategorySuggestion[]): CreatureSubCategorySuggestion[] {
  const buckets = new Map<string, CreatureSubCategorySuggestion[]>()

  for (const item of items) {
    const bucket = buckets.get(item.category)

    if (bucket) {
      bucket.push(item)
    }
    else {
      buckets.set(item.category, [item])
    }
  }

  const queues = [...buckets.values()]
  const result: CreatureSubCategorySuggestion[] = []

  for (let round = 0; result.length < items.length; round += 1) {
    for (const queue of queues) {
      const item = queue[round]

      if (item) {
        result.push(item)
      }
    }
  }

  return result
}

/**
 * 細分類欄的建議：先依目前分類篩選，再依輸入篩選，歷史值優先且去重。
 *
 * 為什麼是「篩掉」而不是「排後面」：魚的細分類（倒吊 / 神仙 / 小丑…）與珊瑚的
 * （LPS / SPS / 軟體）互相之間毫無意義，混在一起只是讓人多滑幾行。分類是使用者
 * 剛剛才選的，這個上下文很硬。
 */
export function searchSubCategorySuggestions(options: SearchSubCategoryOptions): CreatureSubCategorySuggestion[] {
  const query = normalize(options.query ?? '')
  const category = options.category ?? ''
  const limit = options.limit ?? CREATURE_SUGGESTION_LIMIT
  const seen = new Set<string>()
  const results: CreatureSubCategorySuggestion[] = []

  // 沒選分類時把三類交錯開，避免前 8 筆被清單順序決定成全是魚
  const builtin = category ? builtinSubCategories() : interleaveByCategory(builtinSubCategories())

  for (const suggestion of [...(options.history ?? []), ...builtin]) {
    const value = suggestion.subCategory.trim()
    const key = normalize(value)

    if (!key || seen.has(key)) {
      continue
    }

    if (category && suggestion.category !== category) {
      continue
    }

    if (query && !key.includes(query)) {
      continue
    }

    seen.add(key)
    results.push(suggestion)

    if (results.length >= limit) {
      break
    }
  }

  return results
}
