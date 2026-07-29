<script setup lang="ts">
import type { CreatureCategoryKey, CreatureStatusKey, TankOption } from '#shared/types/home'
import type { TankCreaturesData } from '#shared/types/creature'
import { CREATURE_CATEGORY_LABELS, CREATURE_CATEGORY_ORDER, countCreaturesByCategory } from '#shared/utils/creatureCards'
import type { CreatureStatusFilterKey } from '#shared/utils/creatureInventory'
import { CREATURE_STATUS_FILTERS, buildInventoryRows, filterCreatures } from '#shared/utils/creatureInventory'

useSeoMeta({
  title: '生物庫存 · ReefLog',
})

// 「入缸 8 月」與「觀察第 3 天」都是相對現在的推算值。整頁共用同一個時間點，
// 各列才不會各自抓到差一秒的基準。
const now = new Date()

const STATUS_DOT_CLASSES: Record<CreatureStatusKey, string> = {
  ALIVE: 'bg-primary',
  SICK: 'bg-amber-400',
  DEAD: 'bg-neutral-500',
}

const STATUS_TEXT_CLASSES: Record<CreatureStatusKey, string> = {
  ALIVE: 'text-primary',
  SICK: 'text-amber-400',
  DEAD: 'text-dimmed',
}

// 生病：整列底色轉橘；死亡：整列降透明度
const STATUS_ROW_CLASSES: Record<CreatureStatusKey, string> = {
  ALIVE: 'border-default bg-elevated/40',
  SICK: 'border-amber-500/40 bg-amber-500/10',
  DEAD: 'border-default bg-elevated/40 opacity-50',
}

// 選中的 chip 用該狀態自己的顏色：「生病」選中時是橘色，與列上的橘點同一組語彙
const FILTER_SELECTED_CLASSES: Record<CreatureStatusFilterKey, string> = {
  ALL: 'border-primary bg-primary text-inverted',
  ALIVE: 'border-primary bg-primary text-inverted',
  SICK: 'border-amber-500 bg-amber-500 text-inverted',
  DEAD: 'border-neutral-500 bg-neutral-500 text-inverted',
}

const FILTER_IDLE_CLASSES: Record<CreatureStatusFilterKey, string> = {
  ALL: 'border-default text-muted',
  ALIVE: 'border-default text-muted',
  SICK: 'border-amber-500/40 text-amber-400',
  DEAD: 'border-default text-muted',
}

// 沒有照片的縮圖：設計稿的斜線佔位。Tailwind 沒有對應的工具類，直接給漸層。
const PHOTO_PLACEHOLDER = 'repeating-linear-gradient(135deg, rgba(148,163,184,0.16) 0 6px, transparent 6px 12px)'

const { data: tankList } = await useAsyncData('creatures:tanks', () =>
  $fetch<{ tanks: TankOption[] }>('/api/tanks'),
)

const tanks = computed(() => tankList.value?.tanks ?? [])

// 未指定時看的是清單第一個，也就是 schema 定義的「預設缸」
const currentTank = computed(() => tanks.value[0] ?? null)

const { data: inventory } = await useAsyncData<TankCreaturesData | null>(
  'creatures:list',
  () => {
    const tankId = currentTank.value?.id

    return tankId ? $fetch<TankCreaturesData>(`/api/tanks/${tankId}/creatures`) : Promise.resolve(null)
  },
  { watch: [currentTank] },
)

const creatures = computed(() => inventory.value?.creatures ?? [])

// 分類 tab 上的數量是「不受狀態 filter 影響的分類總數」（與首頁的 chip 一致）
const counts = computed(() => countCreaturesByCategory(creatures.value))

const subtitle = computed(() =>
  currentTank.value ? `${currentTank.value.name} · ${counts.value.all} 隻` : '',
)

const tabs = computed(() => CREATURE_CATEGORY_ORDER.map(category => ({
  key: category,
  text: `${CREATURE_CATEGORY_LABELS[category]} · ${counts.value[category]}`,
})))

const activeCategory = ref<CreatureCategoryKey>('FISH')
const activeStatus = ref<CreatureStatusFilterKey>('ALL')

const rows = computed(() =>
  buildInventoryRows(filterCreatures(creatures.value, activeCategory.value, activeStatus.value), now),
)
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <div
      v-if="!currentTank"
      data-testid="tank-empty"
      class="px-4 py-12 text-center"
    >
      <h1 class="text-2xl font-semibold">
        還沒有任何缸
      </h1>

      <p class="mx-auto mt-3 max-w-xs text-balance text-muted">
        生物是記在缸底下的，先建立一個缸才有庫存可看。
      </p>

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
    </div>

    <template v-else>
      <header class="flex items-start justify-between gap-3 px-4 pt-[calc(1.5rem+env(safe-area-inset-top))]">
        <div class="min-w-0">
          <h1 class="truncate text-3xl font-bold">
            生物庫存
          </h1>

          <p
            data-testid="inventory-subtitle"
            class="mt-1 truncate text-sm text-muted"
          >
            {{ subtitle }}
          </p>
        </div>

        <!--
          表單畫面 Epic 中沒有截圖，由另一支 needs-design 的
          「新增 / 編輯生物表單」issue 負責；這裡只渲染按鈕並連向該路由。
        -->
        <UButton
          data-testid="creature-add"
          to="/creatures/new"
          icon="i-lucide-plus"
          color="primary"
          size="lg"
          class="shrink-0 rounded-full px-5 font-semibold"
        >
          新增
        </UButton>
      </header>

      <!-- 分類 tab：選中者為主色文字 + 底線，未選中只有灰字 -->
      <div
        role="tablist"
        aria-label="生物分類"
        class="mt-6 flex border-b border-default px-4"
      >
        <button
          v-for="tab in tabs"
          :key="tab.key"
          data-testid="category-tab"
          type="button"
          role="tab"
          :data-category="tab.key"
          :aria-selected="activeCategory === tab.key ? 'true' : 'false'"
          class="flex-1 border-b-2 pb-3 text-center text-base transition-colors"
          :class="activeCategory === tab.key
            ? 'border-primary font-semibold text-primary'
            : 'border-transparent text-muted'"
          @click="activeCategory = tab.key"
        >
          {{ tab.text }}
        </button>
      </div>

      <div class="mt-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <button
          v-for="filter in CREATURE_STATUS_FILTERS"
          :key="filter.key"
          data-testid="status-filter"
          type="button"
          :data-status="filter.key"
          :aria-pressed="activeStatus === filter.key ? 'true' : 'false'"
          class="shrink-0 rounded-full border px-5 py-2 text-sm transition-colors"
          :class="activeStatus === filter.key
            ? `${FILTER_SELECTED_CLASSES[filter.key]} font-semibold`
            : FILTER_IDLE_CLASSES[filter.key]"
          @click="activeStatus = filter.key"
        >
          {{ filter.label }}
        </button>
      </div>

      <ul
        v-if="rows.length"
        class="mt-2 flex flex-col gap-2 px-4"
      >
        <li
          v-for="row in rows"
          :key="row.id"
          data-testid="creature-row"
          :data-status="row.status"
          class="rounded-2xl border"
          :class="STATUS_ROW_CLASSES[row.status]"
        >
          <NuxtLink
            :to="`/creatures/${row.id}`"
            :aria-label="`${row.title} · ${row.subtitle} · ${row.statusLabel}`"
            class="flex items-center gap-3 p-3"
          >
            <span
              data-testid="creature-photo"
              class="size-16 shrink-0 overflow-hidden rounded-xl bg-elevated"
              :style="row.photoUrl ? undefined : { backgroundImage: PHOTO_PLACEHOLDER }"
            >
              <img
                v-if="row.photoUrl"
                :src="row.photoUrl"
                :alt="row.title"
                class="size-full object-cover"
              >
            </span>

            <div class="min-w-0 flex-1">
              <p
                data-testid="creature-name"
                class="truncate text-lg font-semibold"
              >
                {{ row.title }}
              </p>

              <p
                data-testid="creature-subtitle"
                class="mt-0.5 truncate text-sm"
                :class="row.status === 'ALIVE' ? 'text-muted' : STATUS_TEXT_CLASSES[row.status]"
              >
                {{ row.subtitle }}
              </p>
            </div>

            <span class="flex shrink-0 items-center gap-1.5">
              <span
                data-testid="creature-status-dot"
                :data-status="row.status"
                class="size-2 rounded-full"
                :class="STATUS_DOT_CLASSES[row.status]"
              />
              <span
                data-testid="creature-status"
                class="text-sm"
                :class="STATUS_TEXT_CLASSES[row.status]"
              >
                {{ row.statusLabel }}
              </span>
            </span>
          </NuxtLink>
        </li>
      </ul>

      <p
        v-else
        data-testid="creature-empty"
        class="mt-10 px-4 text-center text-muted"
      >
        這個分類與狀態的組合下還沒有生物。
      </p>
    </template>
  </div>
</template>
