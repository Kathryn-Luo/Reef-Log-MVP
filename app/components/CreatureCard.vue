<script setup lang="ts">
import type { CreatureCardModel } from '#shared/utils/creatureCards'
import { CREATURE_CATEGORY_LABELS } from '#shared/utils/creatureCards'
import type { CreatureStatusKey } from '#shared/types/home'

const props = defineProps<{ card: CreatureCardModel }>()

const STATUS_DOT_CLASSES: Record<CreatureStatusKey, string> = {
  ALIVE: 'bg-primary',
  SICK: 'bg-amber-400',
  DEAD: 'bg-neutral-500',
}

// 生病：整張卡片底色轉橘；死亡：整張降透明度
const STATUS_CARD_CLASSES: Record<CreatureStatusKey, string> = {
  ALIVE: 'border-default bg-elevated/40',
  SICK: 'border-amber-500/40 bg-amber-500/10',
  DEAD: 'border-default bg-elevated/40 opacity-50',
}

const categoryLabel = computed(() => CREATURE_CATEGORY_LABELS[props.card.category])
</script>

<template>
  <article
    data-testid="creature-card"
    :data-status="card.status"
    class="overflow-hidden rounded-2xl border"
    :class="STATUS_CARD_CLASSES[card.status]"
  >
    <NuxtLink
      :to="`/creatures/${card.id}`"
      :aria-label="`${card.title} · ${card.subtitle}`"
      class="block"
    >
      <div
        data-testid="creature-photo"
        class="relative aspect-square bg-elevated"
      >
        <img
          v-if="card.photoUrl"
          :src="card.photoUrl"
          :alt="card.name"
          class="size-full object-cover"
        >

        <span
          data-testid="creature-category"
          class="absolute left-2 top-2 rounded-md bg-default/70 px-2 py-0.5 text-xs text-muted backdrop-blur"
        >
          {{ categoryLabel }}
        </span>

        <span
          data-testid="creature-status-dot"
          :data-status="card.status"
          class="absolute right-2 top-2 size-3 rounded-full"
          :class="STATUS_DOT_CLASSES[card.status]"
        />

        <span
          v-if="card.status === 'SICK'"
          data-testid="creature-watch-flag"
          class="absolute bottom-2 left-2 text-xs font-semibold text-amber-400"
        >
          ⚠ 觀察中
        </span>
      </div>

      <div class="p-3">
        <p
          data-testid="creature-title"
          class="truncate font-semibold"
        >
          {{ card.title }}
        </p>

        <div class="mt-1 flex items-center gap-1.5">
          <span
            class="size-1.5 shrink-0 rounded-full"
            :class="STATUS_DOT_CLASSES[card.status]"
          />
          <p
            data-testid="creature-subtitle"
            class="truncate text-sm text-muted"
          >
            {{ card.subtitle }}
          </p>
        </div>
      </div>
    </NuxtLink>
  </article>
</template>
