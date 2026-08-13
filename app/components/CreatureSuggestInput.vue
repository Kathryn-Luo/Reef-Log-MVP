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
// 但「不用現成的 combobox」不等於「不必遵守 combobox 的協定」（PR #177 的 review）：
// 一旦宣告 role="combobox" 與 role="option"，輔助技術就會照那套規則讀它。所以
// aria-controls、aria-activedescendant 與方向鍵／Enter／Escape 都要自己補上。
//
// 建議項刻意**不是**可聚焦的元素：combobox 的協定是焦點永遠留在輸入框上，由
// aria-activedescendant 指出「現在指著哪一項」。把每一項做成 <button> 的話，
// 鍵盤使用者要按最多 8 次 Tab 才離得開這一個欄位。

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

/** 方向鍵指到第幾項；-1 ＝ 還沒指任何一項（剛展開時就是這個狀態） */
const activeIndex = ref(-1)

const value = computed({
  get: () => props.modelValue,
  set: (next: string) => {
    // 字一改，上一輪指著的那一項就不再對應任何東西
    activeIndex.value = -1
    emit('update:modelValue', next)
  },
})

const visibleItems = computed(() => open.value ? props.items : [])

const listId = computed(() => `${props.id}-suggestions`)

/** aria-activedescendant 指的是 id，所以每一項都要有一個穩定的 id */
function optionId(index: number): string {
  return `${listId.value}-${index}`
}

const activeDescendant = computed(() =>
  activeIndex.value >= 0 && activeIndex.value < visibleItems.value.length
    ? optionId(activeIndex.value)
    : undefined,
)

function close() {
  open.value = false
  activeIndex.value = -1
}

function choose(item: CreatureSuggestionItem) {
  emit('select', item)
  // 選完就收起來：清單留著只會擋住下一個欄位，而使用者要的那件事已經完成
  close()
}

const listEl = useTemplateRef<HTMLElement>('list')

/**
 * 把作用中的那一項捲進可視範圍。
 *
 * 焦點永遠留在輸入框上（combobox 的協定），所以瀏覽器不會替我們捲——上限 8 筆
 * 乘上每項的高度會超過清單的 max-h-64，走到後幾筆時那一項就落在可視區外了。
 *
 * `block: 'nearest'` 而不是 'center'：只在真的看不到時才動，不會每按一下就把清單
 * 重新置中。jsdom 沒有實作 scrollIntoView，所以要容得下它不存在。
 */
async function scrollActiveIntoView() {
  await nextTick()

  const active = listEl.value?.children[activeIndex.value]

  if (active instanceof HTMLElement) {
    active.scrollIntoView?.({ block: 'nearest' })
  }
}

/** 上下移動，並在頭尾繞回去——清單短，繞回去比停在邊界少按幾次 */
function move(step: number) {
  const total = visibleItems.value.length

  if (!total) {
    return
  }

  activeIndex.value = activeIndex.value < 0 && step < 0
    ? total - 1
    : (activeIndex.value + step + total) % total

  void scrollActiveIntoView()
}

/**
 * 建議一換，鍵盤游標就放掉。
 *
 * activeIndex 是索引，不是身分。個人歷史建議是掛載之後才取回來的（Preview／Neon
 * 冷啟動時更慢），它一到就會重排 items——同一個索引這時指向的已經是另一個物種，
 * 使用者接下來那一下 Enter 會選到他根本沒看上的東西（PR #177 的 review）。
 *
 * 選擇「放掉」而不是「用 value 追著跑」：清單重排的當下，使用者心裡指著的是畫面上
 * 的**位置**，把游標搬到那一筆在新順序裡的新位置同樣不是他要的。停在沒有選取的
 * 狀態最誠實——按 Enter 什麼都不會發生，他會再按一次方向鍵。
 */
watch(() => props.items, () => {
  activeIndex.value = -1
})

function onArrow(step: number) {
  // 方向鍵也負責把收起來的清單叫回來：使用者按下去的意思就是「讓我看選項」
  open.value = true
  move(step)
}

/**
 * Enter 只在「清單開著而且指著某一項」時被吃掉。
 *
 * 其餘情況一律放行，否則使用者打完清單外的字、想按 Enter 送出表單時會沒有反應——
 * 而「清單外的值照樣存得進去」正是這兩個欄位的重點（issue #159）。
 */
function onEnter(event: KeyboardEvent) {
  const item = visibleItems.value[activeIndex.value]

  if (!item) {
    return
  }

  event.preventDefault()
  choose(item)
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
    close()
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
      :aria-controls="visibleItems.length > 0 ? listId : undefined"
      :aria-activedescendant="activeDescendant"
      aria-autocomplete="list"
      class="w-full"
      @focus="open = true"
      @input="open = true"
      @keydown.down.prevent="onArrow(1)"
      @keydown.up.prevent="onArrow(-1)"
      @keydown.enter="onEnter"
      @keydown.escape="close"
    />

    <ul
      v-if="visibleItems.length > 0"
      :id="listId"
      ref="list"
      data-testid="creature-suggestion-list"
      role="listbox"
      class="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-default bg-default py-1 shadow-lg"
    >
      <!--
        每一項就是 option 本身，不再包一層 <button>：焦點要留在輸入框上（見檔頭）。
        滑鼠仍然點得到——mousedown.prevent 讓輸入框不失焦，click 才送得到這裡。
      -->
      <li
        v-for="(item, index) in visibleItems"
        :id="optionId(index)"
        :key="`${item.value}-${item.label}`"
        data-testid="creature-suggestion"
        role="option"
        tabindex="-1"
        :data-value="item.value"
        :aria-selected="index === activeIndex"
        class="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm"
        :class="index === activeIndex ? 'bg-elevated' : 'hover:bg-elevated/60'"
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
      </li>
    </ul>
  </div>
</template>
