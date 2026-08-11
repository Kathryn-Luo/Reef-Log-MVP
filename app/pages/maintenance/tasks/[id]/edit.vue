<script setup lang="ts">
import type { MaintenanceTaskInput, MaintenanceTaskResponse } from '#shared/types/maintenance'
import { apiErrorMessage } from '#shared/utils/apiError'

useSeoMeta({ title: '編輯保養任務 · ReefLog' })

const route = useRoute()
const taskId = computed(() => String(route.params.id))
const { $api } = useNuxtApp()

const { data, status, refresh } = await useAsyncData(
  () => `maintenance:tasks:${taskId.value}:edit`,
  () => $api<MaintenanceTaskResponse>(`/api/maintenance-tasks/${taskId.value}`),
  { watch: [taskId] },
)

const task = computed(() => data.value?.task ?? null)
const initial = computed(() => task.value
  ? {
      name: task.value.name,
      intervalDays: String(task.value.intervalDays),
      startOn: task.value.startOn ?? '',
      isActive: task.value.isActive,
    }
  : undefined)

const submitting = ref(false)
const error = ref<string | null>(null)
const { failed: loadFailed, retrying, retry } = useLoadFailure([status], refresh)

async function submit(input: MaintenanceTaskInput) {
  if (submitting.value) {
    return
  }

  error.value = null
  submitting.value = true

  try {
    await $api<MaintenanceTaskResponse>(`/api/maintenance-tasks/${taskId.value}`, {
      method: 'PATCH',
      body: input,
    })
  }
  catch (cause) {
    error.value = apiErrorMessage(cause, '更新失敗，請稍後再試。')
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

  <MaintenanceTaskForm
    v-else-if="task && initial"
    :key="task.id"
    title="編輯保養任務"
    :initial="initial"
    :fallback-start-on="task.createdOn"
    :last-completed-on="task.lastCompletion?.completedOn"
    :submitting="submitting"
    :error="error"
    @submit="submit"
  />
</template>
