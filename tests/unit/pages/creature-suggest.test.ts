import type { VueWrapper } from '@vue/test-utils'
import type { CreatureSuggestionsResponse } from '#shared/types/creature'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import CreatureProfileForm from '../../../app/components/CreatureProfileForm.vue'
import { signedInUserSession } from '../support/session'

// 學名與細分類的自動完成（issue #159）。
//
// 比對規則本身在 tests/unit/shared/creature-species.test.ts；這裡驗的是表單有沒有
// 真的接上它——輸入會不會出現建議、選了會帶入什麼、切換分類會不會換一批、
// 以及清單外的自由文字能不能照樣送出。

mockNuxtImport('useUserSession', () => () => signedInUserSession())

const HISTORY: CreatureSuggestionsResponse = {
  species: [
    {
      names: ['我的怪魚'],
      scientificName: 'Nonexistus fictus',
      category: 'FISH',
      subCategory: '自訂族群',
      source: 'history',
    },
    // 內建清單裡也有這一筆：合併之後只該出現一次
    {
      names: ['火焰仙'],
      scientificName: 'Centropyge loriculus',
      category: 'FISH',
      subCategory: '神仙',
      source: 'history',
    },
  ],
  subCategories: [
    { subCategory: '自訂族群', category: 'FISH', source: 'history' },
    { subCategory: '我的軟體', category: 'CORAL', source: 'history' },
  ],
}

const state = {
  suggestionCalls: 0,
  failSuggestions: false,
}

registerEndpoint('/api/creature-suggestions', () => {
  state.suggestionCalls += 1

  if (state.failSuggestions) {
    throw new Error('suggestions unavailable')
  }

  return HISTORY
})

enableAutoUnmount(afterEach)

beforeEach(() => {
  clearNuxtData()
  clearNuxtState()
  state.suggestionCalls = 0
  state.failSuggestions = false
  vi.useRealTimers()
})

type Form = VueWrapper<InstanceType<typeof CreatureProfileForm>>

async function mountForm(): Promise<Form> {
  const form = await mountSuspended(CreatureProfileForm, {
    props: { title: '新增生物', backTo: '/creatures' },
  })

  // 個人歷史建議是掛載之後才取的，取回來前表單照樣可用
  await flushPromises()

  return form as Form
}

/** 某個欄位當下顯示的建議（照畫面上的順序） */
function suggestionsOf(form: Form, field: string): string[] {
  return form
    .get(`[data-field="${field}"]`)
    .findAll('[data-testid="creature-suggestion"]')
    .map(item => item.attributes('data-value') ?? '')
}

async function type(form: Form, name: string, value: string) {
  await form.get(`[name="${name}"]`).setValue(value)
}

async function choose(form: Form, field: string, value: string) {
  await form.get(`[data-field="${field}"] [data-testid="creature-suggestion"][data-value="${value}"]`).trigger('click')
  await flushPromises()
}

function valueOf(form: Form, name: string): string {
  return (form.get(`[name="${name}"]`).element as HTMLInputElement).value
}

// Given 我尚未建立任何生物
// When  我在學名欄輸入俗名、別名或部分學名
// Then  顯示符合內建物種清單的建議，且可選取其中一項
describe('學名欄可以用俗名搜尋內建物種', () => {
  it('輸入俗名後出現建議', async () => {
    const form = await mountForm()

    expect(suggestionsOf(form, 'scientificName')).toEqual([])

    await type(form, 'scientificName', '火焰')

    expect(suggestionsOf(form, 'scientificName')).toContain('Centropyge loriculus')
    expect(form.get('[data-field="scientificName"]').text()).toContain('火焰仙')
  })

  it('輸入部分學名（小寫）也出現建議', async () => {
    const form = await mountForm()

    await type(form, 'scientificName', 'euphyllia')

    expect(suggestionsOf(form, 'scientificName')).toContain('Euphyllia ancora')
  })

  it('選取其中一項後，學名欄變成該物種的學名', async () => {
    const form = await mountForm()

    await type(form, 'scientificName', '火焰')
    await choose(form, 'scientificName', 'Centropyge loriculus')

    expect(valueOf(form, 'scientificName')).toBe('Centropyge loriculus')
    expect(suggestionsOf(form, 'scientificName')).toEqual([])
  })
})

// Given 我選擇一項物種建議
// When  該建議包含學名與細分類
// Then  表單帶入學名，並只在細分類尚未填寫時帶入建議的細分類
describe('選取物種會帶入學名與細分類', () => {
  it('細分類空白時一併帶入建議的細分類', async () => {
    const form = await mountForm()

    await type(form, 'scientificName', '火焰')
    await choose(form, 'scientificName', 'Centropyge loriculus')

    expect(valueOf(form, 'scientificName')).toBe('Centropyge loriculus')
    expect(valueOf(form, 'subCategory')).toBe('神仙')
  })

  // Given 我已手動填寫細分類
  // When  我改選另一項物種建議
  // Then  不覆蓋我已輸入的細分類
  it('已手動填寫的細分類不被覆蓋', async () => {
    const form = await mountForm()

    await type(form, 'subCategory', '我自己分的類')
    await type(form, 'scientificName', '火焰')
    await choose(form, 'scientificName', 'Centropyge loriculus')

    expect(valueOf(form, 'scientificName')).toBe('Centropyge loriculus')
    expect(valueOf(form, 'subCategory')).toBe('我自己分的類')
  })

  it('只有空白字元的細分類視同尚未填寫', async () => {
    const form = await mountForm()

    await type(form, 'subCategory', '   ')
    await type(form, 'scientificName', '火焰')
    await choose(form, 'scientificName', 'Centropyge loriculus')

    expect(valueOf(form, 'subCategory')).toBe('神仙')
  })
})

// Given 我已選擇生物分類
// When  我開啟或輸入細分類欄位
// Then  只優先顯示符合該分類的內建與個人歷史建議
describe('細分類的建議依目前分類篩選', () => {
  it('選魚時開啟欄位只看到魚的細分類', async () => {
    const form = await mountForm()

    await form.get('[data-testid="creature-category-option"][data-category="FISH"]').trigger('click')
    await form.get('[name="subCategory"]').trigger('focus')

    const suggestions = suggestionsOf(form, 'subCategory')

    expect(suggestions).toContain('神仙')
    expect(suggestions).not.toContain('LPS')
    expect(suggestions).not.toContain('我的軟體')
  })

  it('改選珊瑚後建議跟著更新', async () => {
    const form = await mountForm()

    await form.get('[data-testid="creature-category-option"][data-category="FISH"]').trigger('click')
    await form.get('[name="subCategory"]').trigger('focus')
    await form.get('[data-testid="creature-category-option"][data-category="CORAL"]').trigger('click')

    const suggestions = suggestionsOf(form, 'subCategory')

    expect(suggestions).toContain('LPS')
    expect(suggestions).toContain('我的軟體')
    expect(suggestions).not.toContain('神仙')
  })

  it('選取細分類建議後填入該值', async () => {
    const form = await mountForm()

    await form.get('[data-testid="creature-category-option"][data-category="CORAL"]').trigger('click')
    await form.get('[name="subCategory"]').trigger('focus')
    await choose(form, 'subCategory', 'LPS')

    expect(valueOf(form, 'subCategory')).toBe('LPS')
  })
})

// Given 我過去曾輸入清單中沒有的學名或細分類
// When  我再次新增或編輯自己名下的生物
// Then  去重後的歷史值會出現在建議中，且不包含其他使用者的資料
describe('個人歷史值也會出現在建議中', () => {
  it('表單只向自己的建議 API 取一次歷史值', async () => {
    await mountForm()

    expect(state.suggestionCalls).toBe(1)
  })

  it('清單外的歷史學名搜得到，選取後同樣帶入細分類', async () => {
    const form = await mountForm()

    await type(form, 'scientificName', '怪魚')

    expect(suggestionsOf(form, 'scientificName')).toContain('Nonexistus fictus')

    await choose(form, 'scientificName', 'Nonexistus fictus')

    expect(valueOf(form, 'scientificName')).toBe('Nonexistus fictus')
    expect(valueOf(form, 'subCategory')).toBe('自訂族群')
  })

  it('歷史細分類出現在該分類的建議裡', async () => {
    const form = await mountForm()

    await form.get('[data-testid="creature-category-option"][data-category="FISH"]').trigger('click')
    await form.get('[name="subCategory"]').trigger('focus')

    expect(suggestionsOf(form, 'subCategory')).toContain('自訂族群')
  })

  it('與內建清單重複的歷史值只出現一次', async () => {
    const form = await mountForm()

    await type(form, 'scientificName', '火焰')

    const matched = suggestionsOf(form, 'scientificName').filter(value => value === 'Centropyge loriculus')

    expect(matched).toHaveLength(1)
  })

  it('建議 API 失敗時表單照常可用，只剩內建清單', async () => {
    state.failSuggestions = true

    const form = await mountForm()

    await type(form, 'scientificName', '火焰')

    expect(suggestionsOf(form, 'scientificName')).toContain('Centropyge loriculus')
    expect(form.find('[data-testid="creature-profile-form"]').exists()).toBe(true)
  })
})

// Given 我要輸入建議清單中不存在的值
// When  我直接完成輸入並儲存
// Then  表單接受該自由文字，既有的 trim、選填與 API 驗證行為維持不變
describe('清單外的自由文字照樣送得出去', () => {
  it('沒有選任何建議也能送出，值為輸入的文字', async () => {
    const form = await mountForm()

    await type(form, 'name', '沒人聽過的魚')
    await type(form, 'scientificName', ' Ignotus piscis ')
    await type(form, 'subCategory', ' 我自己分的類 ')
    await type(form, 'addedOn', '2026-08-01')
    await form.get('[data-testid="creature-category-option"][data-category="OTHER"]').trigger('click')
    await form.get('[data-testid="creature-profile-form"]').trigger('submit')

    const submitted = form.emitted('submit')

    expect(submitted).toHaveLength(1)
    expect(submitted![0]![0]).toMatchObject({
      name: '沒人聽過的魚',
      scientificName: 'Ignotus piscis',
      subCategory: '我自己分的類',
      category: 'OTHER',
      addedOn: '2026-08-01',
    })
  })

  it('建議清單不會擋住儲存按鈕', async () => {
    const form = await mountForm()

    await type(form, 'name', '沒人聽過的魚')
    await type(form, 'addedOn', '2026-08-01')
    await form.get('[data-testid="creature-category-option"][data-category="FISH"]').trigger('click')
    await type(form, 'scientificName', '火焰')

    expect(form.get('[data-testid="creature-profile-submit"]').attributes('disabled')).toBeUndefined()
  })
})
