<script setup lang="ts">
import type { CreatureCategoryKey } from '#shared/types/home'
import type { CreatureProfileRequest } from '#shared/types/creature'
import { CREATURE_CATEGORY_OPTIONS, dateOnlyAtTimeZoneOffset, parseCreatureProfileInput } from '#shared/utils/creatureForm'

interface CreatureProfileInitialValue {
  name: string
  scientificName: string
  category: CreatureCategoryKey | ''
  subCategory: string
  addedOn: string
  price: string
}

const props = defineProps<{
  title: string
  backTo: string
  initial?: Partial<CreatureProfileInitialValue>
  submitting?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  submit: [value: CreatureProfileRequest]
}>()

const form = reactive<CreatureProfileInitialValue>({
  name: props.initial?.name ?? '',
  scientificName: props.initial?.scientificName ?? '',
  category: props.initial?.category ?? '',
  subCategory: props.initial?.subCategory ?? '',
  addedOn: props.initial?.addedOn ?? '',
  price: props.initial?.price ?? '',
})

const localError = ref<string | null>(null)
const visibleError = computed(() => localError.value ?? props.error ?? null)
const canSubmit = computed(() =>
  form.name.trim().length > 0
  && form.category !== ''
  && form.addedOn.trim().length > 0,
)

const today = ref<string>()
let todayRefreshTimer: number | undefined

function refreshToday() {
  const now = new Date()
  today.value = dateOnlyAtTimeZoneOffset(now, now.getTimezoneOffset())

  const nextMidnight = new Date(now)
  nextMidnight.setHours(24, 0, 0, 0)
  todayRefreshTimer = window.setTimeout(refreshToday, nextMidnight.getTime() - now.getTime() + 50)
}

onMounted(refreshToday)

onBeforeUnmount(() => {
  if (todayRefreshTimer !== undefined) {
    window.clearTimeout(todayRefreshTimer)
  }
})

function chooseCategory(category: CreatureCategoryKey) {
  form.category = category
  localError.value = null
}

function submit() {
  const timeZoneOffsetMinutes = new Date().getTimezoneOffset()
  const parsed = parseCreatureProfileInput({ ...form, timeZoneOffsetMinutes })

  if (!parsed.ok) {
    localError.value = parsed.message
    return
  }

  localError.value = null
  emit('submit', { ...parsed.value, timeZoneOffsetMinutes })
}
</script>

<template>
  <section class="mx-auto max-w-2xl pb-10">
    <header class="sticky top-0 z-10 flex items-center gap-3 border-b border-default bg-default px-4 py-3">
      <UButton
        :to="backTo"
        icon="i-lucide-chevron-left"
        color="neutral"
        variant="outline"
        aria-label="返回"
        class="shrink-0 rounded-full"
      />

      <h1 class="min-w-0 flex-1 truncate text-xl font-semibold">
        {{ title }}
      </h1>

      <UButton
        data-testid="creature-profile-header-submit"
        type="button"
        color="primary"
        :disabled="!canSubmit"
        :loading="submitting"
        class="shrink-0 rounded-full px-4"
        @click="submit"
      >
        儲存
      </UButton>
    </header>

    <form
      data-testid="creature-profile-form"
      class="space-y-7 px-4 pt-6"
      novalidate
      @submit.prevent="submit"
    >
      <div
        data-testid="creature-profile-field"
        data-field="name"
      >
        <label
          for="creature-name-input"
          class="flex items-center gap-2 text-sm font-medium"
        >
          俗名
          <span class="rounded px-1.5 py-0.5 text-xs font-semibold text-warning ring-1 ring-warning/40">必填</span>
        </label>
        <UInput
          id="creature-name-input"
          v-model="form.name"
          name="name"
          required
          placeholder="火焰仙"
          autocomplete="off"
          class="mt-2 w-full"
        />
      </div>

      <div
        data-testid="creature-profile-field"
        data-field="scientificName"
      >
        <label
          for="creature-scientific-name"
          class="block text-sm font-medium"
        >學名</label>
        <UInput
          id="creature-scientific-name"
          v-model="form.scientificName"
          name="scientificName"
          placeholder="Centropyge loriculus"
          autocomplete="off"
          class="mt-2 w-full"
        />
      </div>

      <fieldset
        data-testid="creature-profile-field"
        data-field="category"
      >
        <legend class="flex items-center gap-2 text-sm font-medium">
          分類
          <span class="rounded px-1.5 py-0.5 text-xs font-semibold text-warning ring-1 ring-warning/40">必填</span>
        </legend>
        <div
          class="mt-2 grid grid-cols-3 gap-2"
          role="group"
          aria-label="生物分類"
        >
          <button
            v-for="option in CREATURE_CATEGORY_OPTIONS"
            :key="option.key"
            data-testid="creature-category-option"
            type="button"
            :data-category="option.key"
            :aria-pressed="form.category === option.key ? 'true' : 'false'"
            class="h-11 rounded-lg border text-sm font-medium transition-colors"
            :class="form.category === option.key
              ? 'border-primary bg-primary text-inverted'
              : 'border-default bg-elevated/40 text-muted'"
            @click="chooseCategory(option.key)"
          >
            {{ option.label }}
          </button>
        </div>
      </fieldset>

      <div
        data-testid="creature-profile-field"
        data-field="subCategory"
      >
        <label
          for="creature-sub-category"
          class="block text-sm font-medium"
        >細分類</label>
        <UInput
          id="creature-sub-category"
          v-model="form.subCategory"
          name="subCategory"
          placeholder="神仙"
          autocomplete="off"
          class="mt-2 w-full"
        />
      </div>

      <div
        data-testid="creature-profile-field"
        data-field="addedOn"
      >
        <label
          for="creature-added-on-input"
          class="flex items-center gap-2 text-sm font-medium"
        >
          入缸日
          <span class="rounded px-1.5 py-0.5 text-xs font-semibold text-warning ring-1 ring-warning/40">必填</span>
        </label>
        <UInput
          id="creature-added-on-input"
          v-model="form.addedOn"
          name="addedOn"
          type="date"
          required
          :max="today"
          class="mt-2 w-full"
        />
      </div>

      <div
        data-testid="creature-profile-field"
        data-field="price"
      >
        <label
          for="creature-price"
          class="block text-sm font-medium"
        >購入價</label>
        <UInput
          id="creature-price"
          v-model="form.price"
          name="price"
          type="number"
          inputmode="decimal"
          min="0"
          step="0.01"
          placeholder="0"
          class="mt-2 w-full"
        >
          <template #trailing>
            <span class="text-xs text-dimmed">元</span>
          </template>
        </UInput>
      </div>

      <p
        v-if="visibleError"
        data-testid="creature-profile-error"
        role="alert"
        class="text-sm text-error"
      >
        {{ visibleError }}
      </p>

      <div class="pt-1">
        <UButton
          data-testid="creature-profile-submit"
          type="submit"
          color="primary"
          size="lg"
          block
          :disabled="!canSubmit"
          :loading="submitting"
          class="rounded-xl py-3"
        >
          儲存
        </UButton>
        <p
          v-if="!canSubmit"
          class="mt-2 text-center text-xs text-dimmed"
        >
          請填寫俗名、分類與入缸日
        </p>
      </div>
    </form>
  </section>
</template>
