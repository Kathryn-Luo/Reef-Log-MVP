<script setup lang="ts">
import type { MaintenanceTaskInput } from '#shared/types/maintenance'
import {
  MAINTENANCE_INTERVAL_OPTIONS,
  MAX_MAINTENANCE_INTERVAL_DAYS,
  parseMaintenanceTaskInput,
} from '#shared/utils/maintenanceTaskForm'

interface MaintenanceTaskInitialValue {
  name: string
  intervalDays: string | number
  startOn: string
  isActive: boolean
}

interface MaintenanceTaskFormValue {
  name: string
  intervalDays: string
  startOn: string
  isActive: boolean
}

const props = defineProps<{
  title: string
  initial?: Partial<MaintenanceTaskInitialValue>
  submitting?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  submit: [value: MaintenanceTaskInput]
}>()

const presetIntervals = MAINTENANCE_INTERVAL_OPTIONS.map(option => String(option.value))
const initialInterval = String(props.initial?.intervalDays ?? '7')

const form = reactive<MaintenanceTaskFormValue>({
  name: props.initial?.name ?? '',
  intervalDays: initialInterval,
  startOn: props.initial?.startOn ?? '',
  isActive: props.initial?.isActive ?? true,
})

const intervalMode = ref(presetIntervals.includes(initialInterval) ? initialInterval : 'custom')
const localError = ref<string | null>(null)
const visibleError = computed(() => localError.value ?? props.error ?? null)
const canSubmit = computed(() => form.name.trim().length > 0 && String(form.intervalDays).trim().length > 0)

function chooseInterval(value: string) {
  intervalMode.value = value
  localError.value = null

  if (value === 'custom') {
    if (presetIntervals.includes(String(form.intervalDays))) {
      form.intervalDays = ''
    }
    return
  }

  form.intervalDays = value
}

function submit() {
  const parsed = parseMaintenanceTaskInput(form)

  if (!parsed.ok) {
    localError.value = parsed.message
    return
  }

  localError.value = null
  emit('submit', parsed.value)
}
</script>

<template>
  <section class="mx-auto max-w-2xl pb-10">
    <header class="sticky top-0 z-10 flex items-center gap-3 border-b border-default bg-default px-4 py-3">
      <UButton
        to="/maintenance"
        icon="i-lucide-chevron-left"
        color="neutral"
        variant="outline"
        aria-label="返回保養提醒"
        class="shrink-0 rounded-full"
      />

      <h1 class="min-w-0 flex-1 truncate text-xl font-semibold">
        {{ title }}
      </h1>

      <UButton
        data-testid="maintenance-task-header-submit"
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
      data-testid="maintenance-task-form"
      class="space-y-7 px-4 pt-6"
      novalidate
      @submit.prevent="submit"
    >
      <div>
        <label
          for="maintenance-task-name"
          class="flex items-center gap-2 text-sm font-medium"
        >
          任務名稱
          <span class="rounded px-1.5 py-0.5 text-xs font-semibold text-warning ring-1 ring-warning/40">必填</span>
        </label>
        <UInput
          id="maintenance-task-name"
          v-model="form.name"
          name="name"
          required
          placeholder="換水 10%"
          autocomplete="off"
          class="mt-2 w-full"
        />
      </div>

      <fieldset>
        <legend class="flex items-center gap-2 text-sm font-medium">
          週期
          <span class="rounded px-1.5 py-0.5 text-xs font-semibold text-warning ring-1 ring-warning/40">必填</span>
        </legend>
        <div
          class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5"
          role="group"
          aria-label="保養週期"
        >
          <button
            v-for="option in MAINTENANCE_INTERVAL_OPTIONS"
            :key="option.value"
            data-testid="maintenance-interval-option"
            type="button"
            :data-interval="option.value"
            :aria-pressed="intervalMode === String(option.value) ? 'true' : 'false'"
            class="h-11 rounded-lg border text-sm font-medium transition-colors"
            :class="intervalMode === String(option.value)
              ? 'border-primary bg-primary text-inverted'
              : 'border-default bg-elevated/40 text-muted'"
            @click="chooseInterval(String(option.value))"
          >
            {{ option.label }}
          </button>
          <button
            data-testid="maintenance-interval-option"
            data-interval="custom"
            type="button"
            :aria-pressed="intervalMode === 'custom' ? 'true' : 'false'"
            class="h-11 rounded-lg border text-sm font-medium transition-colors"
            :class="intervalMode === 'custom'
              ? 'border-primary bg-primary text-inverted'
              : 'border-default bg-elevated/40 text-muted'"
            @click="chooseInterval('custom')"
          >
            自訂
          </button>
        </div>

        <UInput
          v-if="intervalMode === 'custom'"
          v-model="form.intervalDays"
          name="intervalDays"
          type="number"
          inputmode="numeric"
          min="1"
          :max="MAX_MAINTENANCE_INTERVAL_DAYS"
          step="1"
          placeholder="天數"
          class="mt-3 w-full"
        >
          <template #trailing>
            <span class="text-xs text-dimmed">天</span>
          </template>
        </UInput>
      </fieldset>

      <div>
        <label
          for="maintenance-task-start-on"
          class="block text-sm font-medium"
        >起算日</label>
        <UInput
          id="maintenance-task-start-on"
          v-model="form.startOn"
          name="startOn"
          type="date"
          class="mt-2 w-full"
        />
        <p class="mt-2 text-xs text-dimmed">
          留白會從建立當天算起。
        </p>
      </div>

      <USwitch
        v-model="form.isActive"
        data-testid="maintenance-task-active"
        name="isActive"
        label="啟用任務"
        description="停用後不再出現在提醒清單，既有完成紀錄會保留。"
      />

      <p
        v-if="visibleError"
        data-testid="maintenance-task-error"
        role="alert"
        class="text-sm text-error"
      >
        {{ visibleError }}
      </p>

      <UButton
        data-testid="maintenance-task-submit"
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
    </form>
  </section>
</template>
