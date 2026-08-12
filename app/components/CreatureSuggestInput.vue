<script setup lang="ts">
// 可搜尋、可自由輸入的欄位（issue #159）。
//
// 「可自由輸入」是這一支存在的理由：欄位本身仍是一個普通的文字輸入，建議只是浮在
// 它下面的一份清單。使用者打完清單裡沒有的字直接儲存，走的是與本 issue 之前完全
// 相同的路徑——parseCreatureProfileInput 一個字都不必改。
//
// 為什麼不用 UInputMenu：那是一個 combobox，它的值域是「清單裡的項目」，自由文字要
// 靠 create-item 之類的旁路補回來；而這兩個欄位的清單外輸入是常態，不是例外。另外
// 學名欄的「顯示的是俗名、填進去的是學名」在 combobox 的 label/value 模型裡也彆扭。
// 文字輸入仍然是 Nuxt UI 的 UInput，樣式與表單其他欄位一致，沒有另外引入任何套件。
//
// 清單本身刻意用原生的 <button>：與同一張表單上的分類選擇器（CreatureProfileForm）
// 同一個作法，也讓建議在測試裡就是一個點得到的元素，不需要模擬 combobox 的鍵盤協定。

export interface CreatureSuggestionItem {
  /** 選取後填進欄位的值 */
  value: string
  /** 清單上的主標，例如學名建議顯示俗名 */
  label: string
  /** 清單上的副標，例如該俗名對應的學名 */
  hint?: string
  /** 這一筆來自使用者自己的歷史資料 */
  history?: boolean
}

const props = defineProps<{
  id: string
  name: string
  placeholder?: string
  modelValue: string
  /**
   * 這一刻該顯示哪些建議，由呼叫端算好。
   *
   * 「尚未輸入時要不要給建議」因此也是呼叫端的事：細分類在空白時仍給得出該分類的
   * 全部選項，學名則刻意回空陣列（見 shared/utils/creatureSpecies.ts 的兩支搜尋函式）。
   * 這一支只負責「有東西就顯示、選了就回報」。
   */
  items: CreatureSuggestionItem[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'select': [item: CreatureSuggestionItem]
}>()

const open = ref(false)

const value = computed({
  get: () => props.modelValue,
  set: (next: string) => emit('update:modelValue', next),
})

const visibleItems = computed(() => open.value ? props.items : [])

function choose(item: CreatureSuggestionItem) {
  emit('select', item)
  // 選完就收起來：清單留著只會擋住下一個欄位，而使用者要的那件事已經完成
  open.value = false
}

/**
 * 焦點離開整個欄位（含建議清單）才收起來。
 *
 * 用 focusout 而不是 input 的 blur：blur 在點到清單上的按鈕那一刻就會發生，
 * 清單於是在 click 送達之前被移除，按了等於沒按。
 */
function onFocusOut(event: FocusEvent) {
  const next = event.relatedTarget

  if (!(next instanceof Node) || !(event.currentTarget as HTMLElement).contains(next)) {
    open.value = false
  }
}
</script>

<template>
  <div
    class="relative"
    @focusout="onFocusOut"
  >
    <UInput
      :id="id"
      v-model="value"
      :name="name"
      :placeholder="placeholder"
      autocomplete="off"
      role="combobox"
      :aria-expanded="visibleItems.length > 0"
      aria-autocomplete="list"
      class="w-full"
      @focus="open = true"
      @input="open = true"
      @keydown.escape="open = false"
    />

    <ul
      v-if="visibleItems.length > 0"
      data-testid="creature-suggestion-list"
      role="listbox"
      class="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-default bg-default py-1 shadow-lg"
    >
      <li
        v-for="item in visibleItems"
        :key="`${item.value}-${item.label}`"
        role="option"
        :aria-selected="item.value === modelValue"
      >
        <button
          data-testid="creature-suggestion"
          type="button"
          :data-value="item.value"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-elevated/60"
          @mousedown.prevent
          @click="choose(item)"
        >
          <span class="min-w-0 flex-1 truncate">
            {{ item.label }}
            <span
              v-if="item.hint"
              class="ml-1 text-xs text-muted"
            >{{ item.hint }}</span>
          </span>
          <span
            v-if="item.history"
            class="shrink-0 rounded px-1.5 py-0.5 text-xs text-dimmed ring-1 ring-default"
          >用過</span>
        </button>
      </li>
    </ul>
  </div>
</template>
