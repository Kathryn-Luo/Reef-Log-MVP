<script setup lang="ts">
import type { CreatureProfileRequest, CreatureProfileResponse } from '#shared/types/creature'
import type { CreaturePhotoIntent } from '~/components/CreatureProfileForm.vue'
import { apiErrorMessage } from '#shared/utils/apiError'
import { CREATURE_PHOTO_FIELD_NAME } from '#shared/utils/creaturePhotoUpload'

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

/**
 * 照片（issue #154）走自己的一支 API：檔案要 multipart，而基本資料那支是 JSON。
 * 兩者因此是兩趟，順序是「先基本資料、再照片」——照片那趟失敗時，先存下的欄位仍在，
 * 而畫面留在原地說明原因（見下方 catch）。
 */
async function saveProfile(input: CreatureProfileRequest) {
  await $api<CreatureProfileResponse>(`/api/creatures/${creatureId.value}/profile`, {
    method: 'PATCH',
    body: input,
  })
}

async function savePhoto(photo: CreaturePhotoIntent) {
  if (photo.action === 'keep') {
    return
  }

  if (photo.action === 'remove') {
    // 不帶任何參數：要刪哪一張由 server 從那一隻自己的 photoUrl 決定
    await $api<CreatureProfileResponse>(`/api/creatures/${creatureId.value}/photo`, { method: 'DELETE' })
    return
  }

  const body = new FormData()

  body.append(CREATURE_PHOTO_FIELD_NAME, photo.file, photo.file.name)
  await $api<CreatureProfileResponse>(`/api/creatures/${creatureId.value}/photo`, { method: 'POST', body })
}

async function submit(input: CreatureProfileRequest, photo: CreaturePhotoIntent) {
  error.value = null
  submitting.value = true

  try {
    await saveProfile(input)
  }
  catch (cause) {
    error.value = apiErrorMessage(cause, '更新失敗，請稍後再試。')
    return
  }
  finally {
    submitting.value = false
  }

  submitting.value = true

  try {
    await savePhoto(photo)
  }
  catch (cause) {
    // 基本資料已經存進去了，所以這句話只說照片——寫成「更新失敗」的話，
    // 使用者會以為剛才改的名字也沒了，而那不是真的。
    error.value = apiErrorMessage(
      cause,
      photo.action === 'remove' ? '照片移除失敗，請稍後再試。' : '照片上傳失敗，請確認網路後再試一次。',
    )
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
    :photo-url="creature.photoUrl"
    :submitting="submitting"
    :error="error"
    @submit="submit"
  />
</template>
