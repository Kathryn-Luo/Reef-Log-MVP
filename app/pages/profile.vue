<script setup lang="ts">
import type { AvatarResizeOutcome } from '~/utils/avatarImage'
import type { UserProfileResponse } from '#shared/types/profile'
import { apiErrorMessage } from '#shared/utils/apiError'
import { AVATAR_FIELD_NAME, AVATAR_MAX_BYTES } from '#shared/utils/avatarUpload'
import { DISPLAY_NAME_MAX_LENGTH, ownsDisplayName, parseDisplayName } from '#shared/utils/profile'

definePageMeta({ layout: false })
useSeoMeta({ title: '個人資料 · ReefLog' })

const { $api } = useNuxtApp()
const { data: profile, status, refresh } = useAsyncData(
  'profile',
  () => $api<UserProfileResponse>('/api/profile'),
  { lazy: true },
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

// 訪客的顯示名稱固定為「訪客」（schema.prisma 的 User.displayName），PATCH /api/profile
// 會回 403。畫面因此不給編輯入口——這只是 UX，真正的邊界在 server/utils/authorization.ts。
// 與首字頭像共用同一個判斷，理由也是同一個（見 shared/utils/profile.ts 的 ownsDisplayName）。
const canEditName = computed(() => ownsDisplayName(profile.value?.providers))

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
  if (!canEditName.value) {
    return
  }

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

// ── 自訂頭像：上傳與移除（issue #168）─────────────────────────────
//
// 縮圖在 app/utils/avatarImage.ts（只縮不放、長邊 512、WebP），格式與 2 MB 的把關
// 在 server（shared/utils/avatarUpload.ts 的三道檢查）。前端的 `accept` 只是提示，
// 擋不掉的東西一律由 server 回 400，訊息直接顯示給使用者看。

const avatarInput = useTemplateRef<HTMLInputElement>('avatarInput')
const avatarRegion = useTemplateRef<HTMLElement>('avatarRegion')

/**
 * 「這一份送出去必定被退」時要說的話，依卡在哪一關而不同。
 *
 * 四句話刻意各不相同。這幾條路徑只在真實裝置上走得到，而手機沒有 console 可看——
 * 使用者截一張圖過來，這句話就要能指出是哪一關。折成同一句「上傳失敗」的話，
 * 遠端診斷只剩下猜（#168 已經為此多繞了兩輪）。
 *
 * 每一句都給得出下一步（換一張小圖），不是只有一句「不支援」把人丟在原地。
 */
const OVERSIZED_MESSAGES: Record<AvatarResizeOutcome, string> = {
  // 縮圖回報成功，出來的檔案卻仍然超過上限——照理不可能（長邊 512 的 WebP 約 40–80 KB）。
  // 真的看到這句，代表要修的是 resizeAvatar 自己，不是使用者選的圖。
  'resized': '照片縮小後仍然超過上限，請改選一張 2 MB 以內的圖片。',
  'decode-failed': '這台裝置讀不開這張照片，無法在上傳前縮小，請改選一張 2 MB 以內的圖片。',
  'no-canvas-context': '這台裝置無法處理照片，無法在上傳前縮小，請改選一張 2 MB 以內的圖片。',
  'encode-failed': '這台裝置無法轉換照片格式，無法在上傳前縮小，請改選一張 2 MB 以內的圖片。',
}
const uploading = ref(false)
const removing = ref(false)
const confirmingRemove = ref(false)
const avatarError = ref<string | null>(null)

/**
 * 訪客沒有上傳入口：server 一律回 403（GUEST_CANNOT_UPLOAD_AVATAR），畫面就不該給出
 * 一個按了必定失敗的按鈕——與改名入口同一個判準，也共用同一支判斷。
 *
 * 移除**不看**這個條件：`DELETE /api/profile/avatar` 刻意沒有那道 403（見
 * `removeOwnedAvatar`），否則訪客身上既有的自訂頭像會永遠拿不掉。
 */
const canUploadAvatar = computed(() => ownsDisplayName(profile.value?.providers))
const canRemoveAvatar = computed(() => profile.value?.avatarSource === 'custom')
const avatarBusy = computed(() => uploading.value || removing.value)

const uploadLabel = computed(() => {
  if (uploading.value) {
    return '上傳中…'
  }

  return avatarError.value ? '重新上傳' : '更換頭像'
})

function pickAvatar() {
  if (avatarBusy.value) {
    return
  }

  avatarInput.value?.click()
}

async function onAvatarSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null

  // 值一定要清掉，而且是在這裡就清：不清的話，同一張圖選第二次不會再觸發 change
  // （瀏覽器認為值沒變），使用者會覺得「按了沒反應」。放在 await 之後才清也不行——
  // 上傳的那段期間 input 還留著上一次的值。
  input.value = ''

  if (!file || avatarBusy.value) {
    return
  }

  uploading.value = true
  avatarError.value = null

  try {
    // 縮圖失敗時 resizeAvatar 回的是原本那個 File，不是例外：送出去讓 server 判，
    // 總比在前端就把人卡住好（Android 各家 picker 對 accept 的遵守程度不一）。
    const { file: prepared, outcome } = await resizeAvatar(file)

    // 但「手上這一份已經超過 server 的上限」是例外：這一趟必定被退，而退回來的
    // 「圖片請控制在 2 MB 以內」會讓使用者以為換一張就好——他換幾張相機拍的照片
    // 都一樣大，問題不在他選的圖。與其上傳完 6 MB 再說，不如現在就說清楚。
    //
    // 看的是**實際要送出的那一份**的大小，不是「縮圖有沒有成功」：兩者不等價，
    // 而不等價的那一格（縮完仍然過大）正是最需要被看見的那一格。
    if (prepared.size > AVATAR_MAX_BYTES) {
      avatarError.value = OVERSIZED_MESSAGES[outcome]
      return
    }

    const form = new FormData()

    form.append(AVATAR_FIELD_NAME, prepared, prepared.name)

    profile.value = await $api<UserProfileResponse>('/api/profile/avatar', {
      method: 'POST',
      body: form,
    })
  }
  catch (cause) {
    // 「檔案過大」與「格式不支援」是 server 給的兩則不同訊息，原樣顯示。
    // 折成同一句「上傳失敗」的話，使用者換一張小圖再試一次仍然被擋，
    // 而畫面說的是同一件事。說不出原因的（500、離線）才退回這句通用的。
    avatarError.value = apiErrorMessage(cause, '上傳失敗，請確認網路後再試一次。')
  }
  finally {
    uploading.value = false
  }
}

async function removeAvatar() {
  if (avatarBusy.value) {
    return
  }

  removing.value = true
  avatarError.value = null

  try {
    // 不帶任何參數：要刪哪一張由 server 從自己的 customAvatarUrl 決定（#167）
    profile.value = await $api<UserProfileResponse>('/api/profile/avatar', { method: 'DELETE' })
  }
  catch (cause) {
    avatarError.value = apiErrorMessage(cause, '移除失敗，請確認網路後再試一次。')
  }
  finally {
    removing.value = false
    confirmingRemove.value = false
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
          <!--
            tabindex="-1"：移除成功後「移除頭像」那顆按鈕會跟著消失，焦點沒有原路
            可還（見 AvatarRemoveSheet 的 returnFocusFallback）。頭像區塊是這一頁上
            最靠近、又一定還在的落點，而且它正是剛才變動的那個東西。
          -->
          <div
            ref="avatarRegion"
            data-testid="profile-avatar-region"
            tabindex="-1"
            class="relative outline-none"
          >
            <ProfileAvatar
              :avatar-url="profile.avatarUrl"
              :avatar-source="profile.avatarSource"
              :display-name="profile.displayName"
              :providers="profile.providers"
            />

            <!-- 處理中時照片本身也要看得出在等：只有按鈕轉圈的話，人會盯著沒變的舊照片 -->
            <div
              v-if="avatarBusy"
              data-testid="profile-avatar-busy"
              class="absolute inset-0 grid place-items-center rounded-full bg-default/70"
              role="status"
              aria-label="頭像處理中"
            >
              <UIcon
                name="i-lucide-loader-circle"
                class="size-8 animate-spin text-primary"
              />
            </div>
          </div>

          <form
            v-if="editing && canEditName"
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
                v-if="canEditName"
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

          <!--
            頭像的兩個動作。上傳與移除都是一般的動作按鈕、不是導向連結，
            所以 loading / disabled 用得上（CLAUDE.md 那條講的是 `UButton` 帶 `to`
            的連結型按鈕——那種一旦被 disable，點下去的整頁導向會一起被取消）。
          -->
          <!-- 兩個動作都沒有時整塊不出現，不留一段空著的間距（訪客且沒有自訂頭像） -->
          <div
            v-if="canUploadAvatar || canRemoveAvatar || avatarError"
            class="mt-7 w-full max-w-md"
          >
            <template v-if="canUploadAvatar">
              <!--
                accept 列三種具體 MIME，**不可**寫 image/*：iOS 相機預設存 HEIC，
                image/* 會讓它原封不動交出 .heic；列具體 MIME 時 iOS 會在選取當下
                自動轉成 JPEG。

                也**不可**加 capture：那會直接叫起相機並拿掉「從相簿選」，而頭像
                多數是挑現成照片。不加時原生選單本來就同時提供拍照與相簿。
              -->
              <input
                ref="avatarInput"
                data-testid="profile-avatar-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="選擇頭像圖片"
                class="hidden"
                @change="onAvatarSelected"
              >

              <UButton
                data-testid="profile-avatar-upload"
                type="button"
                :icon="uploading ? undefined : 'i-lucide-camera'"
                color="primary"
                variant="outline"
                size="xl"
                block
                :loading="uploading"
                :disabled="avatarBusy"
                class="rounded-2xl py-4 text-base font-bold"
                @click="pickAvatar"
              >
                {{ uploadLabel }}
              </UButton>

              <!--
                限制文案只寫格式。**不寫 2 MB**：前端縮圖之後使用者永遠碰不到那條線，
                寫出來只會造成「我的照片 5 MB 是不是不能傳」的誤解。
              -->
              <p
                data-testid="profile-avatar-hint"
                class="mt-3 text-center text-sm text-dimmed"
              >
                支援 JPEG / PNG / WebP
              </p>
            </template>

            <div
              v-if="avatarError"
              data-testid="profile-avatar-error"
              role="alert"
              class="mt-4 flex items-start gap-3 rounded-2xl border border-error bg-error/10 p-4 text-left"
            >
              <UIcon
                name="i-lucide-circle-alert"
                class="mt-0.5 size-5 shrink-0 text-error"
                aria-hidden="true"
              />
              <p class="min-w-0 text-sm text-toned">
                {{ avatarError }}
              </p>
            </div>

            <!-- 沒有自訂頭像就沒有這個動作：沒有東西可以移除 -->
            <button
              v-if="canRemoveAvatar"
              data-testid="profile-avatar-remove"
              type="button"
              :disabled="avatarBusy"
              class="mt-3 w-full py-2 text-center text-sm text-dimmed transition-colors hover:text-error disabled:hover:text-dimmed"
              @click="confirmingRemove = true"
            >
              移除頭像
            </button>
          </div>
        </div>

        <AvatarRemoveSheet
          :open="confirmingRemove"
          :removing="removing"
          :return-focus-fallback="avatarRegion"
          @close="confirmingRemove = false"
          @confirm="removeAvatar"
        />

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
