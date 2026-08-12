<script setup lang="ts">
import type { UserProfileResponse } from '#shared/types/profile'
import { apiErrorMessage } from '#shared/utils/apiError'
import { DISPLAY_NAME_MAX_LENGTH, parseDisplayName } from '#shared/utils/profile'

definePageMeta({ layout: false })
useSeoMeta({ title: '個人資料 · ReefLog' })

const { $api } = useNuxtApp()
const { data: profile, status, refresh } = useAsyncData('profile', () =>
  $api<UserProfileResponse>('/api/profile'),
)
const { failed: loadFailed, retrying, retry } = useLoadFailure([status], refresh)

const editing = ref(false)
const draftName = ref('')
const nameError = ref<string | null>(null)
const saving = ref(false)

const visibleName = computed(() => profile.value?.displayName?.trim() || '未設定名稱')
const nameCount = computed(() => [...draftName.value].length)
const parsedDraft = computed(() => parseDisplayName({ displayName: draftName.value }))
const canSave = computed(() =>
  (!parsedDraft.value.ok
    || parsedDraft.value.value !== (profile.value?.displayName ?? '').trim())
  && !saving.value,
)

const providerLabels: Record<string, string> = {
  GOOGLE: 'Google 登入',
  GUEST: '訪客',
}

const providers = computed(() =>
  profile.value?.providers.map(provider => providerLabels[provider] ?? provider).join('、') ?? '',
)

const joinedOn = computed(() => {
  if (!profile.value) {
    return ''
  }

  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(profile.value.createdAt))
})

function startEditing() {
  draftName.value = profile.value?.displayName ?? ''
  nameError.value = null
  editing.value = true
}

function cancelEditing() {
  draftName.value = profile.value?.displayName ?? ''
  nameError.value = null
  editing.value = false
}

async function saveName() {
  if (saving.value) {
    return
  }

  const parsed = parseDisplayName({ displayName: draftName.value })

  if (!parsed.ok) {
    nameError.value = parsed.message
    return
  }

  saving.value = true
  nameError.value = null

  try {
    profile.value = await $api<UserProfileResponse>('/api/profile', {
      method: 'PATCH',
      body: { displayName: parsed.value },
    })
    editing.value = false
  }
  catch (cause) {
    draftName.value = profile.value?.displayName ?? ''
    nameError.value = apiErrorMessage(cause, '名稱更新失敗，請稍後再試。')
    editing.value = false
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="dark min-h-dvh bg-default text-default">
    <section class="mx-auto min-h-dvh max-w-2xl pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <header class="sticky top-0 z-10 flex items-center gap-3 border-b border-default bg-default/95 px-4 py-3 backdrop-blur">
        <UButton
          to="/"
          icon="i-lucide-chevron-left"
          color="neutral"
          variant="outline"
          aria-label="返回首頁"
          class="shrink-0 rounded-full"
        />
        <h1 class="text-xl font-semibold">
          個人資料
        </h1>
      </header>

      <LoadErrorState
        v-if="loadFailed"
        title-tag="p"
        :retrying="retrying"
        @retry="retry"
      />

      <div
        v-else-if="status === 'pending' || !profile"
        data-testid="profile-loading"
        class="space-y-6 px-4 py-10"
        aria-label="正在載入個人資料"
      >
        <div class="mx-auto size-28 animate-pulse rounded-full bg-elevated" />
        <div class="mx-auto h-8 w-40 animate-pulse rounded bg-elevated" />
        <div class="h-48 animate-pulse rounded-lg bg-elevated" />
      </div>

      <main
        v-else
        data-testid="profile-account"
        class="px-4 pt-10"
      >
        <div class="flex flex-col items-center">
          <ProfileAvatar
            :avatar-url="profile.avatarUrl"
            :avatar-source="profile.avatarSource"
            :display-name="profile.displayName"
          />

          <form
            v-if="editing"
            data-testid="profile-name-form"
            class="mt-7 w-full max-w-md"
            novalidate
            @submit.prevent="saveName"
          >
            <label
              for="profile-display-name"
              class="sr-only"
            >顯示名稱</label>
            <UInput
              id="profile-display-name"
              v-model="draftName"
              name="displayName"
              autocomplete="nickname"
              autofocus
              class="w-full"
              :ui="{ base: 'text-center text-lg' }"
            />

            <div class="mt-2 flex items-start justify-between gap-3 text-sm">
              <p
                v-if="nameError"
                data-testid="profile-name-error"
                role="alert"
                class="text-error"
              >
                {{ nameError }}
              </p>
              <span v-else />
              <span
                data-testid="profile-name-count"
                class="shrink-0"
                :class="nameCount > DISPLAY_NAME_MAX_LENGTH ? 'text-error' : 'text-muted'"
              >{{ nameCount }} / {{ DISPLAY_NAME_MAX_LENGTH }}</span>
            </div>

            <div class="mt-5 grid grid-cols-2 gap-3">
              <UButton
                data-testid="profile-name-cancel"
                type="button"
                color="neutral"
                variant="outline"
                block
                :disabled="saving"
                @click="cancelEditing"
              >
                取消
              </UButton>
              <UButton
                data-testid="profile-name-save"
                type="submit"
                color="primary"
                block
                :disabled="!canSave"
                :loading="saving"
              >
                儲存
              </UButton>
            </div>
          </form>

          <div
            v-else
            class="mt-7 text-center"
          >
            <div class="flex items-center justify-center gap-2">
              <h2
                data-testid="profile-display-name"
                class="max-w-[min(22rem,75vw)] break-words text-2xl font-semibold"
              >
                {{ visibleName }}
              </h2>
              <UButton
                data-testid="profile-name-edit"
                type="button"
                icon="i-lucide-pencil"
                color="neutral"
                variant="outline"
                aria-label="編輯顯示名稱"
                class="shrink-0 rounded-full"
                @click="startEditing"
              />
            </div>
            <p
              v-if="nameError"
              data-testid="profile-name-error"
              role="alert"
              class="mt-3 text-sm text-error"
            >
              {{ nameError }}
            </p>
          </div>
        </div>

        <section
          aria-labelledby="account-heading"
          class="mt-10"
        >
          <h2
            id="account-heading"
            class="px-1 text-xs font-semibold text-muted"
          >
            帳號資訊
          </h2>

          <dl class="mt-3 divide-y divide-default border-y border-default">
            <div
              v-if="profile.email"
              data-testid="profile-email"
              class="flex items-start justify-between gap-5 py-4"
            >
              <dt class="text-sm text-muted">
                Email
              </dt>
              <dd class="min-w-0 break-all text-right">
                {{ profile.email }}
              </dd>
            </div>
            <div
              data-testid="profile-providers"
              class="flex items-start justify-between gap-5 py-4"
            >
              <dt class="text-sm text-muted">
                登入方式
              </dt>
              <dd class="text-right">
                {{ providers }}
              </dd>
            </div>
            <div
              data-testid="profile-created-at"
              class="flex items-start justify-between gap-5 py-4"
            >
              <dt class="text-sm text-muted">
                加入日期
              </dt>
              <dd class="font-mono text-right">
                {{ joinedOn }}
              </dd>
            </div>
          </dl>
        </section>

        <form
          data-testid="profile-logout-form"
          action="/auth/logout"
          method="post"
          class="mt-10"
        >
          <UButton
            data-testid="profile-logout"
            type="submit"
            icon="i-lucide-log-out"
            color="error"
            variant="outline"
            size="xl"
            block
          >
            登出
          </UButton>
        </form>
      </main>
    </section>
  </div>
</template>
