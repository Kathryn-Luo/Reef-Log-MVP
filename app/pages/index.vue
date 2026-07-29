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

// 「· 4h」與「存活 · N 月」都是相對現在的推算值。整頁共用同一個時間點，
// 摘要列與卡片才不會各自抓到差一秒的基準。
const now = new Date()

const { data: tankList } = await useAsyncData('home:tanks', () =>
  $fetch<{ tanks: TankOption[] }>('/api/tanks'),
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

    return tankId ? $fetch<TankHomeData>(`/api/tanks/${tankId}/home`) : Promise.resolve(null)
  },
  { watch: [currentTankId] },
)

const creatures = computed(() => home.value?.creatures ?? [])
const counts = computed(() => countCreaturesByCategory(creatures.value))

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
      class="px-4 py-16 text-center"
    >
      <UIcon
        name="i-lucide-waves"
        class="mx-auto mb-4 size-10 text-primary"
      />
      <p class="text-muted">
        還沒有任何缸。建立第一個缸之後，這裡會顯示水質與生物的狀態。
      </p>

      <!-- 空狀態不能只說明「建立之後會怎樣」：這是新使用者唯一的入口（issue #46） -->
      <UButton
        data-testid="tank-empty-action"
        to="/tanks/new"
        icon="i-lucide-plus"
        color="primary"
        size="lg"
        class="mt-6 rounded-full px-5"
      >
        建立第一個缸
      </UButton>
    </div>

    <template v-else>
      <TankHeader
        :tanks="tanks"
        :current-tank-id="currentTank.id"
        @select="selectedTankId = $event"
      />

      <div class="mt-4 px-4">
        <WaterSummaryCard
          :water="home?.water ?? null"
          :now="now"
        />
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
    </template>
  </div>
</template>
