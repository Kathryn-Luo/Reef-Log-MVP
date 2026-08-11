<script setup lang="ts">
import type { TankOption } from '#shared/types/home'
import type { CreatureProfileRequest, CreatureProfileResponse } from '#shared/types/creature'
import { apiErrorMessage } from '#shared/utils/apiError'

useSeoMeta({ title: '新增生物 · ReefLog' })

const route = useRoute()
const { $api } = useNuxtApp()

const { data, status, refresh } = await useAsyncData('creatures:new:tanks', () =>
  $api<{ tanks: TankOption[] }>('/api/tanks'),
)

const tanks = computed(() => data.value?.tanks ?? [])
const requestedTankId = computed(() => typeof route.query.tank === 'string' ? route.query.tank : null)
const currentTank = computed(() =>
  tanks.value.find(tank => tank.id === requestedTankId.value) ?? tanks.value[0] ?? null,
)

const submitting = ref(false)
const error = ref<string | null>(null)
const { failed: loadFailed, retrying, retry } = useLoadFailure([status], refresh)

async function submit(input: CreatureProfileRequest) {
  if (!currentTank.value) {
    error.value = '找不到可加入生物的缸。'
    return
  }

  error.value = null
  submitting.value = true

  let created: CreatureProfileResponse

  try {
    created = await $api<CreatureProfileResponse>(`/api/tanks/${currentTank.value.id}/creatures`, {
      method: 'POST',
      body: input,
    })
  }
  catch (cause) {
    error.value = apiErrorMessage(cause, '建立失敗，請稍後再試。')
    return
  }
  finally {
    submitting.value = false
  }

  await navigateTo(`/creatures/${created.creature.id}`)
}
</script>

<template>
  <LoadErrorState
    v-if="loadFailed"
    :retrying="retrying"
    @retry="retry"
  />

  <section
    v-else-if="!currentTank"
    class="mx-auto max-w-2xl px-4 py-12 text-center"
  >
    <h1 class="text-2xl font-semibold">
      還沒有任何缸
    </h1>
    <p class="mt-3 text-muted">
      先建立一個缸，才能登錄生物。
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

  <CreatureProfileForm
    v-else
    title="新增生物"
    back-to="/creatures"
    :submitting="submitting"
    :error="error"
    @submit="submit"
  />
</template>
