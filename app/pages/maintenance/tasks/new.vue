<script setup lang="ts">
import type { TankOption } from '#shared/types/home'
import type { CreateMaintenanceTaskInput, MaintenanceTaskInput, MaintenanceTaskResponse } from '#shared/types/maintenance'
import { apiErrorMessage } from '#shared/utils/apiError'
import { toLocalDateOnly } from '#shared/utils/maintenance'

useSeoMeta({ title: '新增保養任務 · ReefLog' })

const { $api } = useNuxtApp()
const { data, status, refresh } = await useAsyncData('maintenance:tasks:new:tanks', () =>
  $api<{ tanks: TankOption[] }>('/api/tanks'),
)

const tanks = computed(() => data.value?.tanks ?? [])
const currentTank = computed(() => tanks.value[0] ?? null)
const submitting = ref(false)
const error = ref<string | null>(null)
const { failed: loadFailed, retrying, retry } = useLoadFailure([status], refresh)
const { preparing: sandboxPreparing, ensure } = useGuestSandbox()

const tanksEmpty = computed(() => status.value === 'success' && tanks.value.length === 0)
const preparing = computed(() => !loadFailed.value && tanksEmpty.value && sandboxPreparing.value)

watch(tanks, () => {
  if (tanksEmpty.value) {
    void ensure(refresh)
  }
}, { immediate: true })

async function submit(input: MaintenanceTaskInput) {
  if (!currentTank.value || submitting.value) {
    return
  }

  error.value = null
  submitting.value = true

  try {
    await $api<MaintenanceTaskResponse>(`/api/tanks/${currentTank.value.id}/maintenance-tasks`, {
      method: 'POST',
      body: {
        ...input,
        localCreatedOn: toLocalDateOnly(new Date()),
      } satisfies CreateMaintenanceTaskInput,
    })
  }
  catch (cause) {
    error.value = apiErrorMessage(cause, '建立失敗，請稍後再試。')
    return
  }
  finally {
    submitting.value = false
  }

  await navigateTo('/maintenance')
}
</script>

<template>
  <LoadErrorState
    v-if="loadFailed"
    :retrying="retrying"
    @retry="retry"
  />

  <SandboxPreparingState v-else-if="preparing" />

  <section
    v-else-if="!currentTank"
    class="mx-auto max-w-2xl px-4 py-12 text-center"
  >
    <h1 class="text-2xl font-semibold">
      還沒有任何缸
    </h1>
    <p class="mt-3 text-muted">
      先建立一個缸，才能新增保養任務。
    </p>
    <UButton
      to="/tanks/new"
      icon="i-lucide-plus"
      color="primary"
      class="mt-8"
    >
      建立缸
    </UButton>
  </section>

  <MaintenanceTaskForm
    v-else
    title="新增保養任務"
    :submitting="submitting"
    :error="error"
    @submit="submit"
  />
</template>
