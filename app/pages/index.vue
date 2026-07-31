<script setup lang="ts">
import type { CreatureCategoryKey, TankHomeData, TankOption } from '#shared/types/home'
import {
  CREATURE_CATEGORY_LABELS,
  CREATURE_CATEGORY_ORDER,
  buildCreatureCards,
  countCreaturesByCategory,
} from '#shared/utils/creatureCards'

useSeoMeta({
  title: 'ReefLog',
})

// 空狀態下方的三格預告，對應底部 tab 的三個檢視畫面（#40）
const EMPTY_PREVIEWS = [
  { label: '水質趨勢', icon: 'i-lucide-trending-up' },
  { label: '生物庫存', icon: 'i-lucide-circle' },
  { label: '保養提醒', icon: 'i-lucide-diamond' },
] as const

// 「· 4h」與「存活 · N 月」都是相對現在的推算值。整頁共用同一個時間點，
// 摘要列與卡片才不會各自抓到差一秒的基準。
const now = new Date()

// $api 而不是裸 $fetch：session 過期時要被帶去登入頁，而不是停在一頁空資料上（#67）
const { $api } = useNuxtApp()

const { data: tankList } = await useAsyncData('home:tanks', () =>
  $api<{ tanks: TankOption[] }>('/api/tanks'),
)

const tanks = computed(() => tankList.value?.tanks ?? [])

// 未選擇時看的是清單第一個，也就是 schema 定義的「預設缸」。
// 建立缸的表單會帶著 ?tank=<id> 導回來，讓剛建立的那個缸成為當前缸——
// 新缸的 displayOrder 最大，不指名的話看到的會是排序第一個的舊缸。
const route = useRoute()
const selectedTankId = ref<string | null>(
  typeof route.query.tank === 'string' ? route.query.tank : null,
)
const currentTankId = computed(() =>
  tanks.value.find(tank => tank.id === selectedTankId.value)?.id ?? tanks.value[0]?.id ?? null,
)
const currentTank = computed(() => tanks.value.find(tank => tank.id === currentTankId.value) ?? null)

const { data: home } = await useAsyncData<TankHomeData | null>(
  'home:tank-data',
  () => {
    const tankId = currentTankId.value

    return tankId ? $api<TankHomeData>(`/api/tanks/${tankId}/home`) : Promise.resolve(null)
  },
  { watch: [currentTankId] },
)

const creatures = computed(() => home.value?.creatures ?? [])
const counts = computed(() => countCreaturesByCategory(creatures.value))

// 向下捲動時固定的頁首收合成兩層（缸名列 + 水質單行 pill）。
// animated 是「過場已開放」——首幀（瀏覽器還原捲動位置那次）要直接落在最終樣態，不補播動畫。
const { collapsed, animated } = useHeaderCollapse()

// 數據儀表板（screen-2）的展開狀態。關閉的手勢有三種（✕ / 遮罩 / 下拉把手），
// 狀態放在頁面這一層，三者才是在改同一個開關。
const dashboardOpen = ref(false)

// 換缸時把儀表板收起來：留著的話會變成「新缸的頁首配舊缸的數據」。
watch(currentTankId, () => {
  dashboardOpen.value = false
})

const activeCategory = ref<CreatureCategoryKey | 'ALL'>('ALL')

const chips = computed(() => [
  { key: 'ALL' as const, text: '全部' },
  ...CREATURE_CATEGORY_ORDER.map(category => ({
    key: category,
    text: `${CREATURE_CATEGORY_LABELS[category]} ${counts.value[category]}`,
  })),
])

const cards = computed(() =>
  buildCreatureCards(
    activeCategory.value === 'ALL'
      ? creatures.value
      : creatures.value.filter(creature => creature.category === activeCategory.value),
    now,
  ),
)
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <div
      v-if="!currentTank"
      data-testid="tank-empty"
      class="px-4 py-12 text-center"
    >
      <!-- 設計稿的空缸插圖：虛線缸壁 + 水線 + 中央的加號 -->
      <div
        class="mx-auto grid h-56 w-full max-w-sm place-items-center rounded-3xl border border-dashed border-muted bg-gradient-to-b from-transparent to-primary/5"
        aria-hidden="true"
      >
        <div class="relative flex w-full items-center justify-center">
          <span class="absolute inset-x-0 h-px bg-primary/40" />
          <span class="relative grid size-20 place-items-center rounded-full border border-primary/60 bg-default">
            <UIcon
              name="i-lucide-plus"
              class="size-8 text-primary"
            />
          </span>
        </div>
      </div>

      <h1 class="mt-8 text-3xl font-bold">
        還沒有任何缸
      </h1>

      <p class="mx-auto mt-3 max-w-xs text-balance text-muted">
        建立你的第一個缸，開始記錄水質、追蹤生物與接收保養提醒。
      </p>

      <!-- 空狀態不能只說明「建立之後會怎樣」：這是新使用者唯一的入口（issue #46） -->
      <UButton
        data-testid="tank-empty-action"
        to="/tanks/new"
        icon="i-lucide-plus"
        color="primary"
        size="xl"
        block
        class="mt-8 rounded-2xl py-4 text-base font-semibold"
      >
        建立我的第一個缸
      </UButton>

      <!--
        設計稿在按鈕下方預告三項功能。還沒有缸時它們沒有資料可看，
        點進去只會看到另一個空狀態，所以這裡只呈現、不連出去。
      -->
      <div class="mt-4 grid grid-cols-3 gap-3">
        <button
          v-for="preview in EMPTY_PREVIEWS"
          :key="preview.label"
          data-testid="tank-empty-preview"
          type="button"
          disabled
          class="grid place-items-center gap-2 rounded-2xl border border-default px-2 py-5 text-xs text-dimmed"
        >
          <UIcon
            :name="preview.icon"
            class="size-5"
          />
          {{ preview.label }}
        </button>
      </div>
    </div>

    <template v-else>
      <!--
        向下捲看生物時要一直看得到的兩層：缸名列（我在看哪一缸）與水質 pill（有沒有異常）。
        捲過門檻後兩層一起收合（缸副標與六格數字讓位），固定區從約 236px 縮到約 92px，
        生物卡片的可捲動區域才真的變大——只釘住不收合的話，看起來就只是把整段頁首改成 fixed。

        間距一律給在容器內部：容器若留外距，捲動的卡片會從縫隙穿過去，backdrop blur 就破了。
        z-30 要低於 BottomTabBar 的 z-50（tab 列不能被蓋住），又高於生物卡片（卡片從下方穿過）。
        不能加 overflow-*，否則 TankHeader 的切換缸選單會被裁掉。

        收合是漸變不是瞬變（issue #55）：兩層各自把讓位的那一塊補間到 0 高，
        這裡只補上固定區自己的內距。reef-motion-off 是首幀的「這一幀不要動」，
        瀏覽器還原捲動位置時才不會先展開再演一次收合。
      -->
      <div
        data-testid="home-sticky-header"
        :data-collapsed="collapsed ? 'true' : 'false'"
        :data-animated="animated ? 'true' : 'false'"
        class="sticky top-0 z-30 border-b border-default bg-default/80 backdrop-blur pt-[env(safe-area-inset-top)] transition-[padding] duration-200 ease-out motion-reduce:transition-none"
        :class="[collapsed ? 'pb-2' : 'pb-4', animated ? '' : 'reef-motion-off']"
      >
        <TankHeader
          :tanks="tanks"
          :current-tank-id="currentTank.id"
          :collapsed="collapsed"
          @select="selectedTankId = $event"
        />

        <div
          class="px-4 transition-[margin] duration-200 ease-out motion-reduce:transition-none"
          :class="collapsed ? 'mt-2' : 'mt-4'"
        >
          <WaterSummaryCard
            :water="home?.water ?? null"
            :now="now"
            :collapsed="collapsed"
            @expand="dashboardOpen = true"
          />
        </div>
      </div>

      <section class="mt-6 px-4">
        <div class="flex items-center justify-between gap-3">
          <h2 class="flex items-baseline gap-2 text-2xl font-semibold">
            生物
            <span
              data-testid="creature-total"
              class="text-sm font-normal text-muted"
            >{{ counts.all }} 隻</span>
          </h2>

          <!--
            表單畫面 Epic 中沒有截圖，由另一支 needs-design 的
            「新增 / 編輯生物表單」issue 負責；這裡只渲染按鈕並連向該路由。
          -->
          <UButton
            to="/creatures/new"
            icon="i-lucide-plus"
            color="primary"
            class="shrink-0 rounded-full px-4"
          >
            新增
          </UButton>
        </div>

        <div class="mt-4 flex gap-2 overflow-x-auto pb-1">
          <button
            v-for="chip in chips"
            :key="chip.key"
            data-testid="creature-chip"
            type="button"
            :data-category="chip.key"
            :aria-pressed="activeCategory === chip.key ? 'true' : 'false'"
            class="shrink-0 rounded-full border px-4 py-1.5 text-sm transition-colors"
            :class="activeCategory === chip.key
              ? 'border-primary bg-primary text-inverted font-semibold'
              : 'border-default text-muted'"
            @click="activeCategory = chip.key"
          >
            {{ chip.text }}
          </button>
        </div>

        <div
          v-if="cards.length"
          class="mt-4 grid grid-cols-2 gap-3"
        >
          <CreatureCard
            v-for="card in cards"
            :key="`${card.status}-${card.name}`"
            :card="card"
          />
        </div>

        <p
          v-else
          data-testid="creature-empty"
          class="mt-8 text-center text-muted"
        >
          這個分類還沒有生物。
        </p>
      </section>

      <!--
        點一下水質摘要列升起的數據儀表板（screen-2）。
        放在頁面最後、sticky 頁首之外：它是覆蓋整個畫面的一層，
        留在 sticky 容器裡會被容器的 z-30 壓在底部 tab 列（z-50）之下。
      -->
      <WaterDashboardSheet
        :open="dashboardOpen"
        :tank-name="currentTank.name"
        :water="home?.water ?? null"
        :now="now"
        @close="dashboardOpen = false"
      />
    </template>
  </div>
</template>
