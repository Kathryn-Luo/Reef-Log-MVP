<script setup lang="ts">
import type { CreatureProfileRequest, CreatureProfileResponse } from '#shared/types/creature'
import { apiErrorMessage } from '#shared/utils/apiError'

useSeoMeta({ title: '編輯生物 · ReefLog' })

const route = useRoute()
const creatureId = computed(() => route.params.id as string)
const { $api } = useNuxtApp()

const { data, status, refresh } = await useAsyncData(
  () => `creatures:${creatureId.value}:edit`,
  () => $api<CreatureProfileResponse>(`/api/creatures/${creatureId.value}`),
  { watch: [creatureId] },
)

const creature = computed(() => data.value?.creature ?? null)
const initial = computed(() => creature.value
  ? {
      name: creature.value.name,
      scientificName: creature.value.scientificName ?? '',
      category: creature.value.category,
      subCategory: creature.value.subCategory ?? '',
      addedOn: creature.value.addedOn,
      price: creature.value.price === null ? '' : String(creature.value.price),
    }
  : undefined)

const submitting = ref(false)
const error = ref<string | null>(null)
const { failed: loadFailed, retrying, retry } = useLoadFailure([status], refresh)

async function submit(input: CreatureProfileRequest) {
  error.value = null
  submitting.value = true

  try {
    await $api<CreatureProfileResponse>(`/api/creatures/${creatureId.value}/profile`, {
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

  await navigateTo(`/creatures/${creatureId.value}`)
}
</script>

<template>
  <LoadErrorState
    v-if="loadFailed"
    :retrying="retrying"
    @retry="retry"
  />

  <CreatureProfileForm
    v-else-if="creature && initial"
    title="編輯生物"
    :back-to="`/creatures/${creatureId}`"
    :initial="initial"
    :submitting="submitting"
    :error="error"
    @submit="submit"
  />
</template>
