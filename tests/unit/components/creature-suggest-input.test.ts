import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import CreatureSuggestInput from '../../../app/components/CreatureSuggestInput.vue'
import type { CreatureSuggestionItem } from '../../../app/components/CreatureSuggestInput.vue'

// 建議欄位的鍵盤與無障礙協定（issue #159，PR #177 的 review）。
//
// 這一支不用 UInputMenu，理由寫在元件開頭。但「不用現成的 combobox」不等於「不必遵守
// combobox 的協定」——宣告了 role="combobox" 與 role="option"，輔助技術就會照那套規則
// 讀它。少了 aria-controls / aria-activedescendant 與方向鍵，螢幕報讀使用者只知道
// 「這裡展開了」，卻不知道展開了什麼、也走不進去。
//
// 另一半是 tab 順序：建議項若各自是可聚焦的元素，鍵盤使用者要按最多 8 次 Tab 才離得開
// 這一個欄位。combobox 的協定正是為了避免這件事——焦點永遠留在輸入框上。

const ITEMS: CreatureSuggestionItem[] = [
  { value: 'Centropyge loriculus', label: '火焰仙', hint: 'Centropyge loriculus' },
  { value: 'Centropyge heraldi', label: '黃新娘', hint: 'Centropyge heraldi' },
  { value: 'Zebrasoma flavescens', label: '黃三角倒吊', hint: 'Zebrasoma flavescens', history: true },
]

function mountInput(items: CreatureSuggestionItem[] = ITEMS) {
  return mountSuspended(CreatureSuggestInput, {
    props: { id: 'scientificName', name: 'scientificName', modelValue: 'Centropyge', items },
  })
}

async function open(field: Awaited<ReturnType<typeof mountInput>>) {
  await field.get('input').trigger('focus')
  return field
}

// jsdom 沒有實作 scrollIntoView，元件必須容得下它不存在（真實瀏覽器一定有）。
// 這裡補一支替身，順便讓「有沒有捲」變成可以斷言的事。
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

describe('CreatureSuggestInput 的 combobox 協定', () => {
  it('combobox 以 aria-controls 指向那份清單', async () => {
    const field = await open(await mountInput())

    const listId = field.get('[data-testid="creature-suggestion-list"]').attributes('id')

    expect(listId).toBeTruthy()
    expect(field.get('input').attributes('aria-controls')).toBe(listId)
    expect(field.get('input').attributes('aria-expanded')).toBe('true')
  })

  it('收起來時不宣稱自己是展開的，也不指向不存在的清單', async () => {
    const field = await mountInput([])

    expect(field.find('[data-testid="creature-suggestion-list"]').exists()).toBe(false)
    expect(field.get('input').attributes('aria-expanded')).toBe('false')
    expect(field.get('input').attributes('aria-controls')).toBeUndefined()
  })

  it('建議項不進 tab 順序——焦點永遠留在輸入框上', async () => {
    const field = await open(await mountInput())

    // 可聚焦的元素只有輸入框本身
    expect(field.findAll('[data-testid="creature-suggestion"] button')).toHaveLength(0)

    for (const option of field.findAll('[data-testid="creature-suggestion"]')) {
      expect(option.attributes('tabindex')).toBe('-1')
    }
  })

  it('方向鍵移動 aria-activedescendant，並在頭尾繞回去', async () => {
    const field = await open(await mountInput())
    const input = field.get('input')
    const optionIds = field.findAll('[data-testid="creature-suggestion"]')
      .map(option => option.attributes('id'))

    expect(optionIds.every(Boolean)).toBe(true)
    // 剛展開時還沒有任何一項被指著：使用者尚未表示要選哪一個
    expect(input.attributes('aria-activedescendant')).toBeUndefined()

    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(input.attributes('aria-activedescendant')).toBe(optionIds[0])

    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(input.attributes('aria-activedescendant')).toBe(optionIds[1])

    await input.trigger('keydown', { key: 'ArrowUp' })
    expect(input.attributes('aria-activedescendant')).toBe(optionIds[0])

    // 往上越過第一項回到最後一項
    await input.trigger('keydown', { key: 'ArrowUp' })
    expect(input.attributes('aria-activedescendant')).toBe(optionIds[2])
  })

  it('被指著的那一項才是 aria-selected', async () => {
    const field = await open(await mountInput())

    await field.get('input').trigger('keydown', { key: 'ArrowDown' })

    const selected = field.findAll('[data-testid="creature-suggestion"]')
      .filter(option => option.attributes('aria-selected') === 'true')

    expect(selected).toHaveLength(1)
    expect(selected[0]!.attributes('data-value')).toBe('Centropyge loriculus')
  })

  it('Enter 選取目前指著的那一項並收起清單', async () => {
    const field = await open(await mountInput())
    const input = field.get('input')

    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })

    expect(field.emitted('select')?.[0]?.[0]).toMatchObject({ value: 'Centropyge heraldi' })
    expect(field.find('[data-testid="creature-suggestion-list"]').exists()).toBe(false)
  })

  it('沒有指著任何一項時，Enter 不選取任何東西', async () => {
    const field = await open(await mountInput())

    await field.get('input').trigger('keydown', { key: 'Enter' })

    expect(field.emitted('select')).toBeUndefined()
  })

  // 表單裡按 Enter 的預設行為是送出。清單開著又指著某一項時，那一下要被這裡吃掉，
  // 否則使用者想選建議卻直接把表單送了出去。
  it('Enter 選取時擋掉表單送出，沒有選取時放行', async () => {
    const field = await open(await mountInput())
    const input = field.get('input')

    await input.trigger('keydown', { key: 'ArrowDown' })

    const chosen = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    input.element.dispatchEvent(chosen)
    expect(chosen.defaultPrevented).toBe(true)

    await input.trigger('keydown', { key: 'Escape' })

    const passthrough = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    input.element.dispatchEvent(passthrough)
    expect(passthrough.defaultPrevented).toBe(false)
  })

  it('Escape 收起清單並清掉 aria-activedescendant', async () => {
    const field = await open(await mountInput())
    const input = field.get('input')

    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Escape' })

    expect(field.find('[data-testid="creature-suggestion-list"]').exists()).toBe(false)
    expect(input.attributes('aria-activedescendant')).toBeUndefined()
  })

  // PR #177 的 review：個人歷史建議是掛載之後才取回來的（Preview／Neon 冷啟動時更慢）。
  // 它一回來就會把 items 重排，而 activeIndex 是個索引——同一個數字這時指向的已經是
  // 另一個物種，接下來那一下 Enter 會選到使用者根本沒看上的東西。
  it('建議清單被重排時放掉鍵盤游標，不會指到換過來的另一筆', async () => {
    const field = await mountInput()
    const input = field.get('input')

    await input.trigger('focus')
    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(input.attributes('aria-activedescendant')).toBeTruthy()

    // 歷史建議回來了，同一批項目換了順序
    await field.setProps({ items: [ITEMS[2]!, ITEMS[0]!, ITEMS[1]!] })

    expect(input.attributes('aria-activedescendant')).toBeUndefined()

    // 而且不會誤選：這一下 Enter 什麼都不該發生
    await input.trigger('keydown', { key: 'Enter' })
    expect(field.emitted('select')).toBeUndefined()
  })

  // 8 筆 × 約 40px 高於清單的 max-h-64（256px），走到後幾筆時作用中的那一項會落在
  // 可視區外——焦點留在輸入框上，瀏覽器不會替我們捲。
  it('方向鍵移動時把作用中的那一項捲進可視範圍', async () => {
    const field = await open(await mountInput())
    const input = field.get('input')

    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'ArrowDown' })

    const active = field.get('[data-testid="creature-suggestion"][data-value="Centropyge heraldi"]')

    expect(active.element.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('重新輸入後不再指著上一輪的那一項', async () => {
    const field = await open(await mountInput())
    const input = field.get('input')

    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.setValue('Zebra')

    expect(input.attributes('aria-activedescendant')).toBeUndefined()
  })

  it('點擊仍然可以選取（滑鼠使用者的路徑沒有被鍵盤支援換掉）', async () => {
    const field = await open(await mountInput())

    await field.get('[data-testid="creature-suggestion"][data-value="Centropyge heraldi"]').trigger('click')

    expect(field.emitted('select')?.[0]?.[0]).toMatchObject({ value: 'Centropyge heraldi' })
  })
})
