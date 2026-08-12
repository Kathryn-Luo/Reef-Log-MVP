<script setup lang="ts">
import type { AvatarSource } from '#shared/types/profile'
import { ownsDisplayName, profileInitial } from '#shared/utils/profile'

const props = defineProps<{
  avatarUrl: string | null
  avatarSource: AvatarSource
  displayName: string | null
  providers: string[]
}>()

const imageFailed = ref(false)

// 純訪客沒有屬於自己的名字，首字頭像對他沒有意義——退到預設 icon 那一層（見 ownsDisplayName）
const initial = computed(() =>
  ownsDisplayName(props.providers) ? profileInitial(props.displayName) : null,
)
const showImage = computed(() => Boolean(props.avatarUrl) && !imageFailed.value)

watch(() => props.avatarUrl, () => {
  imageFailed.value = false
})
</script>

<template>
  <div class="relative size-28 shrink-0">
    <img
      v-if="showImage"
      data-testid="profile-avatar-image"
      :src="avatarUrl!"
      :alt="`${displayName || '使用者'}的頭像`"
      class="size-full rounded-full border-4 border-default object-cover ring-2 ring-muted"
      @error="imageFailed = true"
    >

    <div
      v-else-if="initial"
      data-testid="profile-avatar-initial"
      class="grid size-full place-items-center rounded-full border border-primary/30 bg-primary/15 text-4xl font-bold text-primary"
      aria-label="名稱首字頭像"
    >
      {{ initial }}
    </div>

    <div
      v-else
      data-testid="profile-avatar-icon"
      class="grid size-full place-items-center rounded-full border border-default bg-elevated text-muted"
      aria-label="預設使用者頭像"
    >
      <UIcon
        name="i-lucide-circle-user-round"
        class="size-12"
      />
    </div>

    <span
      v-if="showImage && avatarSource === 'google'"
      data-testid="profile-avatar-google"
      aria-label="Google 頭像"
      class="absolute right-0 bottom-0 grid size-8 place-items-center rounded-full border-2 border-default bg-white text-sm font-bold text-blue-600"
    >G</span>
  </div>
</template>
