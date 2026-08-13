<script setup lang="ts">
import type { TankOption } from '#shared/types/home'
import type { CreatureProfileRequest, CreatureProfileResponse } from '#shared/types/creature'
import type { CreaturePhotoIntent } from '~/components/CreatureProfileForm.vue'
import { apiErrorMessage } from '#shared/utils/apiError'
import { CREATURE_PHOTO_FIELD_NAME } from '#shared/utils/creaturePhotoUpload'

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
const { preparing: sandboxPreparing, ensure } = useGuestSandbox()

const tanksEmpty = computed(() => status.value === 'success' && tanks.value.length === 0)
const preparing = computed(() => !loadFailed.value && tanksEmpty.value && sandboxPreparing.value)

watch(tanks, () => {
  if (tanksEmpty.value) {
    void ensure(refresh)
  }
}, { immediate: true })

/**
 * 已經建立好的那一隻（issue #154）。
 *
 * 照片必須等生物有了 id 才上傳得了，所以這一頁是「兩趟」：先 POST 建立，再 POST 照片。
 * 第二趟失敗時**不能**讓下一次儲存又建一隻新的——使用者按下「儲存」的意思從頭到尾
 * 只有一個。記著 id 之後，重試就只重試照片那一趟。
 */
const createdCreatureId = ref<string | null>(null)

async function submit(input: CreatureProfileRequest, photo: CreaturePhotoIntent) {
  if (!currentTank.value) {
    error.value = '找不到可加入生物的缸。'
    return
  }

  error.value = null
  submitting.value = true

  try {
    if (!createdCreatureId.value) {
      const created = await $api<CreatureProfileResponse>(`/api/tanks/${currentTank.value.id}/creatures`, {
        method: 'POST',
        body: input,
      })

      createdCreatureId.value = created.creature.id
    }
  }
  catch (cause) {
    error.value = apiErrorMessage(cause, '建立失敗，請稍後再試。')
    return
  }
  finally {
    submitting.value = false
  }

  // 新增這一頁沒有「移除」可言（還沒有照片），所以只處理 replace
  if (photo.action === 'replace') {
    submitting.value = true

    try {
      const body = new FormData()

      body.append(CREATURE_PHOTO_FIELD_NAME, photo.file, photo.file.name)
      await $api<CreatureProfileResponse>(`/api/creatures/${createdCreatureId.value}/photo`, { method: 'POST', body })
    }
    catch (cause) {
      // 生物已經建立了，所以話要說清楚：再按一次儲存只會重試照片，不會多一隻。
      // 「檔案過大」與「格式不支援」是 server 給的兩則不同訊息，原樣顯示。
      error.value = `${apiErrorMessage(cause, '照片上傳失敗，請確認網路後再試一次。')}（生物已建立，再按一次儲存只會重試照片）`
      return
    }
    finally {
      submitting.value = false
    }
  }

  await navigateTo(`/creatures/${createdCreatureId.value}`)
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
