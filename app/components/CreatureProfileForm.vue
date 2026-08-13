<script setup lang="ts">
import type { ImageResizeOutcome } from '~/utils/avatarImage'
import type { CreatureCategoryKey } from '#shared/types/home'
import type { CreatureProfileRequest, CreatureSpeciesSuggestion, CreatureSuggestionsResponse } from '#shared/types/creature'
import type { UserProfileResponse } from '#shared/types/profile'
import type { CreatureSuggestionItem } from './CreatureSuggestInput.vue'
import { CREATURE_CATEGORY_OPTIONS, dateOnlyAtTimeZoneOffset, parseCreatureProfileInput } from '#shared/utils/creatureForm'
import {
  ALLOWED_CREATURE_PHOTO_CONTENT_TYPES,
  CREATURE_PHOTO_MAX_BYTES,
  CREATURE_PHOTO_UNSUPPORTED_MESSAGE,
} from '#shared/utils/creaturePhotoUpload'
import { ownsDisplayName } from '#shared/utils/profile'
import { searchSpeciesSuggestions, searchSubCategorySuggestions } from '#shared/utils/creatureSpecies'

interface CreatureProfileInitialValue {
  name: string
  scientificName: string
  category: CreatureCategoryKey | ''
  subCategory: string
  addedOn: string
  price: string
}

/**
 * 這次儲存要對照片做什麼（issue #154）。
 *
 * 照片刻意**不跟著基本資料那支 JSON 一起送**：檔案要走 multipart，而新增時那一隻
 * 生物還沒有 id 可以掛。所以表單只負責「使用者的意思」，真正打哪一支 API 由頁面決定
 *（新增是「先建立再上傳」，編輯是「PATCH 之後再上傳或刪除」）。
 */
export type CreaturePhotoIntent
  /** 沒有動照片——連照片相關的 API 都不必打 */
  = | { action: 'keep' }
    /** 換上這一份（已經縮好、也通過前端那一關） */
    | { action: 'replace', file: File }
    /** 把目前這一張拿掉 */
    | { action: 'remove' }

const props = defineProps<{
  title: string
  backTo: string
  initial?: Partial<CreatureProfileInitialValue>
  /**
   * 目前這一隻身上的照片（編輯時帶入），null／未給＝還沒有。
   *
   * 刻意不放進 `initial`：那一組是「表單欄位的初始值」，會被使用者邊打邊改；
   * 照片不是輸入框，它的狀態是「換成哪一份 / 要不要拿掉」（見 CreaturePhotoIntent）。
   */
  photoUrl?: string | null
  submitting?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  submit: [value: CreatureProfileRequest, photo: CreaturePhotoIntent]
}>()

const form = reactive<CreatureProfileInitialValue>({
  name: props.initial?.name ?? '',
  scientificName: props.initial?.scientificName ?? '',
  category: props.initial?.category ?? '',
  subCategory: props.initial?.subCategory ?? '',
  addedOn: props.initial?.addedOn ?? '',
  price: props.initial?.price ?? '',
})

const localError = ref<string | null>(null)
const visibleError = computed(() => localError.value ?? props.error ?? null)
const canSubmit = computed(() =>
  form.name.trim().length > 0
  && form.category !== ''
  && form.addedOn.trim().length > 0,
)

const today = ref<string>()
let todayRefreshTimer: number | undefined

function refreshToday() {
  const now = new Date()
  today.value = dateOnlyAtTimeZoneOffset(now, now.getTimezoneOffset())

  const nextMidnight = new Date(now)
  nextMidnight.setHours(24, 0, 0, 0)
  todayRefreshTimer = window.setTimeout(refreshToday, nextMidnight.getTime() - now.getTime() + 50)
}

onMounted(refreshToday)

onBeforeUnmount(() => {
  if (todayRefreshTimer !== undefined) {
    window.clearTimeout(todayRefreshTimer)
  }
})

function chooseCategory(category: CreatureCategoryKey) {
  form.category = category
  localError.value = null
}

// ── 學名與細分類的自動完成（issue #159）──
//
// 建議有兩個來源：repo 內的內建物種清單（shared/utils/creatureSpecies.ts）與這位
// 使用者過去輸入過的值。後者掛載後才取，而且**失敗不擋表單**——建議是輸入輔助，
// 取不到就只剩內建清單，人照樣打得完字、存得下去。
const history = ref<CreatureSuggestionsResponse>({ species: [], subCategories: [] })

onMounted(async () => {
  try {
    // $api 而不是裸 $fetch：session 過期時要被帶去登入頁，而不是靜靜地少一份建議（#67）
    history.value = await useNuxtApp().$api<CreatureSuggestionsResponse>('/api/creature-suggestions')
  }
  catch {
    // 內建清單仍在，不必打擾使用者
  }
})

const speciesItems = computed<CreatureSuggestionItem[]>(() =>
  searchSpeciesSuggestions({ query: form.scientificName, history: history.value.species })
    .map(species => ({
      // 主標是俗名：使用者記得的是「火焰仙」，欄位要填的才是學名
      label: species.names[0] ?? species.scientificName,
      hint: species.scientificName,
      value: species.scientificName,
      history: species.source === 'history',
    })),
)

const subCategoryItems = computed<CreatureSuggestionItem[]>(() =>
  searchSubCategorySuggestions({
    query: form.subCategory,
    category: form.category,
    history: history.value.subCategories,
  }).map(item => ({
    label: item.subCategory,
    value: item.subCategory,
    history: item.source === 'history',
  })),
)

/** 選取的那一筆物種原始資料——建議項只帶得動字串，帶入細分類要回頭找它 */
function findSpecies(scientificName: string): CreatureSpeciesSuggestion | undefined {
  return searchSpeciesSuggestions({ query: scientificName, history: history.value.species })
    .find(species => species.scientificName === scientificName)
}

/**
 * 選取一項物種建議：帶入學名，**只在細分類還空著時**才一併帶入細分類。
 *
 * 「只在空著時」是 Story 的定案：已經手動填過的細分類不該被一次選取蓋掉——
 * 那是使用者自己下的判斷，而建議永遠只是猜測。
 */
function chooseSpecies(item: CreatureSuggestionItem) {
  form.scientificName = item.value

  if (form.subCategory.trim()) {
    return
  }

  const subCategory = findSpecies(item.value)?.subCategory

  if (subCategory) {
    form.subCategory = subCategory
  }
}

// ── 照片（issue #154）────────────────────────────────────────────
//
// 這一段只做三件事：讓使用者選一張、在送出前先縮好、把「要換還是要拿掉」交給頁面。
// 真正的上傳與刪除是頁面的事（見 CreaturePhotoIntent），因為新增時那一隻還沒有 id。
//
// 縮圖在 app/utils/creaturePhotoImage.ts（只縮不放、長邊 1024、WebP），格式與 2 MB
// 的把關在 server（shared/utils/creaturePhotoUpload.ts 的三道檢查）。前端的 `accept`
// 只是提示，擋不掉的東西一律由 server 回 400，訊息直接顯示給使用者看。

const photoInput = useTemplateRef<HTMLInputElement>('photoInput')

/** 目前存在 server 上的那一張（編輯時由頁面帶入） */
const savedPhotoUrl = computed(() => props.photoUrl ?? null)

/** 這次選的那一份（已縮好）與它的預覽網址 */
const pendingPhoto = ref<File | null>(null)
const pendingPreview = ref<string | null>(null)
const photoRemoved = ref(false)
const photoError = ref<string | null>(null)

/**
 * 「這一份送出去必定被退」時要說的話，依卡在哪一關而不同（與 profile.vue 同一個作法）。
 *
 * 四句話刻意各不相同：這幾條路徑只在真實裝置上走得到，而手機沒有 console 可看。
 * 使用者截一張圖過來，這句話就要能指出是哪一關。
 */
const OVERSIZED_MESSAGES: Record<ImageResizeOutcome, string> = {
  // 縮圖回報成功、出來的檔案卻仍然超過上限——照理不可能（長邊 1024 的 WebP 約 150–300 KB）。
  // 真的看到這句，代表要修的是 resizeCreaturePhoto 自己，不是使用者選的圖。
  'resized': '照片縮小後仍然超過上限，請改選一張 2 MB 以內的圖片。',
  'decode-failed': '這台裝置讀不開這張照片，無法在上傳前縮小，請改選一張 2 MB 以內的圖片。',
  'no-canvas-context': '這台裝置無法處理照片，無法在上傳前縮小，請改選一張 2 MB 以內的圖片。',
  'encode-failed': '這台裝置無法轉換照片格式，無法在上傳前縮小，請改選一張 2 MB 以內的圖片。',
}

/**
 * 這個帳號能不能上傳。
 *
 * 訪客一律被 server 擋成 403（GUEST_CANNOT_UPLOAD_PHOTO），畫面就不該給出一個按了
 * 必定失敗的入口——與 Profile 頁藏起上傳鈕同一個判準，也共用同一支判斷。
 *
 * `null`＝還沒問到（載入中或那支 API 失敗）。這時**當作可以上傳**：真正的邊界在
 * server，猜錯最多是多看到一則 403 訊息；反過來預設藏起來的話，一次 `/api/profile`
 * 失敗就會讓 Google 使用者以為這個功能不存在。
 */
const providers = ref<string[] | null>(null)
const canUploadPhoto = computed(() => providers.value === null || ownsDisplayName(providers.value))

onMounted(async () => {
  try {
    providers.value = (await useNuxtApp().$api<UserProfileResponse>('/api/profile')).providers
  }
  catch {
    // 問不到就維持 null＝當作可以上傳，理由見上
  }
})

/**
 * 畫面上此刻該顯示哪一張：剛選的優先，其次是還沒被拿掉的那一張。
 *
 * 剛選的那一份做不出預覽網址時回 `null`（見 `previewUrlFor`），**不會退回舊照片**——
 * 退回去的話，畫面顯示的是一張即將被換掉的圖，比沒有預覽更容易誤導。
 */
const visiblePhoto = computed(() => {
  if (pendingPhoto.value) {
    return pendingPreview.value
  }

  return photoRemoved.value ? null : savedPhotoUrl.value
})

/** 有沒有「一張照片」在這次儲存之後會留在這一隻身上——決定按鈕說「選擇」還是「更換」 */
const hasPhoto = computed(() => pendingPhoto.value !== null || (!photoRemoved.value && savedPhotoUrl.value !== null))
const canRemovePhoto = computed(() => !pendingPhoto.value && !photoRemoved.value && savedPhotoUrl.value !== null)

/**
 * 預覽網址是 best-effort：做不出來就沒有預覽，但**選到的檔案照樣留著**。
 *
 * `createObjectURL` 在少數環境裡會丟（測試環境的 File 實作、極舊的 WebView）。
 * 讓它往外拋的話，使用者選了照片卻整個表單沒反應——而預覽只是好看，
 * 真正要送出去的是那個 File 本身。
 */
function previewUrlFor(file: File): string | null {
  try {
    return URL.createObjectURL(file)
  }
  catch {
    return null
  }
}

function releasePreview() {
  if (pendingPreview.value) {
    URL.revokeObjectURL(pendingPreview.value)
    pendingPreview.value = null
  }
}

onBeforeUnmount(releasePreview)

function pickPhoto() {
  photoInput.value?.click()
}

/** 取消這次選取（或清掉錯誤），回到「照片維持原樣」 */
function clearPendingPhoto() {
  releasePreview()
  pendingPhoto.value = null
  photoError.value = null
  localError.value = null
}

/** 把目前這一張拿掉。真正的 DELETE 在儲存時才發（見 CreaturePhotoIntent） */
function removePhoto() {
  clearPendingPhoto()
  photoRemoved.value = true
}

async function onPhotoSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null

  // 值一定要清掉，而且是在這裡就清：不清的話，同一張圖選第二次不會再觸發 change
  // （瀏覽器認為值沒變），使用者會覺得「按了沒反應」。
  input.value = ''

  if (!file) {
    return
  }

  // 縮圖失敗時回的是原本那個 File，不是例外（見 resizeImage）——先看實際要送出的
  // 那一份能不能過關，再決定要收下還是就地說明。
  const { file: prepared, outcome } = await resizeCreaturePhoto(file)

  releasePreview()
  pendingPhoto.value = null

  // 「手上這一份已經超過 server 的上限」：這一趟必定被退，而退回來的
  // 「照片請控制在 2 MB 以內」會讓使用者以為換一張就好——他換幾張相機拍的照片
  // 都一樣大，問題不在他選的圖。看的是**實際要送出的那一份**的大小。
  if (prepared.size > CREATURE_PHOTO_MAX_BYTES) {
    photoError.value = OVERSIZED_MESSAGES[outcome]
    return
  }

  // 縮得動的話出來的一定是 WebP 或 JPEG（見 OUTPUT_FORMATS），所以走到這裡還不合格的
  // 只可能是「這台裝置縮不動，而原檔本來就不是我們收的格式」——例如 HEIC 或選錯檔案。
  if (!(ALLOWED_CREATURE_PHOTO_CONTENT_TYPES as string[]).includes(prepared.type)) {
    photoError.value = CREATURE_PHOTO_UNSUPPORTED_MESSAGE
    return
  }

  pendingPhoto.value = prepared
  pendingPreview.value = previewUrlFor(prepared)
  photoError.value = null
  localError.value = null
  photoRemoved.value = false
}

/** 這次儲存要對照片做什麼。沒選也沒按移除就是 keep——照片那兩支 API 一支都不會被打。 */
function photoIntent(): CreaturePhotoIntent {
  if (pendingPhoto.value) {
    return { action: 'replace', file: pendingPhoto.value }
  }

  return photoRemoved.value && savedPhotoUrl.value ? { action: 'remove' } : { action: 'keep' }
}

function submit() {
  // Story 第二條：檔案不合格時「儲存被阻擋」。照片欄位旁邊那句話說的是哪裡不合格，
  // 這裡再說一次「所以現在存不了」——按下儲存卻毫無反應才是最難理解的那一種。
  if (photoError.value) {
    localError.value = '照片還沒處理好：請改選一張照片，或先取消選取。'
    return
  }

  const timeZoneOffsetMinutes = new Date().getTimezoneOffset()
  const parsed = parseCreatureProfileInput({ ...form, timeZoneOffsetMinutes })

  if (!parsed.ok) {
    localError.value = parsed.message
    return
  }

  localError.value = null
  emit('submit', { ...parsed.value, timeZoneOffsetMinutes }, photoIntent())
}
</script>

<template>
  <section class="mx-auto max-w-2xl pb-10">
    <header class="sticky top-0 z-10 flex items-center gap-3 border-b border-default bg-default px-4 py-3">
      <UButton
        :to="backTo"
        icon="i-lucide-chevron-left"
        color="neutral"
        variant="outline"
        aria-label="返回"
        class="shrink-0 rounded-full"
      />

      <h1 class="min-w-0 flex-1 truncate text-xl font-semibold">
        {{ title }}
      </h1>

      <UButton
        data-testid="creature-profile-header-submit"
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
      data-testid="creature-profile-form"
      class="space-y-7 px-4 pt-6"
      novalidate
      @submit.prevent="submit"
    >
      <!--
        照片（issue #154）放在最前面：它是庫存列表上最先被認出來的東西，
        而表單的順序該跟著「使用者怎麼認這一隻」走。
      -->
      <div
        data-testid="creature-profile-field"
        data-field="photo"
      >
        <span class="block text-sm font-medium">照片</span>

        <div class="mt-2 flex items-center gap-4">
          <!-- 沒有照片時是與庫存列表同一款的斜線佔位，讓「還沒有照片」看得出來是刻意的 -->
          <div
            class="size-24 shrink-0 overflow-hidden rounded-xl border border-default bg-elevated/40"
            :style="visiblePhoto ? undefined : { backgroundImage: CREATURE_PHOTO_PLACEHOLDER }"
          >
            <img
              v-if="visiblePhoto"
              data-testid="creature-photo-preview"
              :src="visiblePhoto"
              alt="生物照片預覽"
              class="size-full object-cover"
            >
          </div>

          <div class="min-w-0 flex-1">
            <template v-if="canUploadPhoto">
              <!--
                accept 列三種具體 MIME，**不可**寫 image/*：iOS 相機預設存 HEIC，
                image/* 會讓它原封不動交出 .heic；列具體 MIME 時 iOS 會在選取當下
                自動轉成 JPEG。

                也**不可**加 capture：那會直接叫起相機並拿掉「從相簿選」，而多數人
                是先拍好照片、事後才登錄這一隻。不加時原生選單本來就兩條路都給。
              -->
              <input
                ref="photoInput"
                data-testid="creature-photo-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="選擇生物照片"
                class="hidden"
                @change="onPhotoSelected"
              >

              <UButton
                data-testid="creature-photo-choose"
                type="button"
                icon="i-lucide-camera"
                color="neutral"
                variant="outline"
                @click="pickPhoto"
              >
                {{ hasPhoto ? '更換照片' : '選擇照片' }}
              </UButton>

              <!--
                限制文案只寫格式。**不寫 2 MB**：送出前一律縮圖，使用者正常操作永遠
                碰不到那條線，寫出來只會造成「我的照片 5 MB 是不是不能傳」的誤解。
              -->
              <p
                data-testid="creature-photo-hint"
                class="mt-2 text-xs text-dimmed"
              >
                支援 JPEG / PNG / WebP
              </p>
            </template>

            <!--
              訪客沒有上傳入口（server 一律回 403，見 GUEST_CANNOT_UPLOAD_PHOTO），
              但要說得出為什麼——欄位默默消失的話，人只會以為這個功能不存在。
            -->
            <p
              v-else
              data-testid="creature-photo-guest-hint"
              class="text-xs text-dimmed"
            >
              訪客不能上傳照片，改用 Google 登入後才能加照片。
            </p>

            <button
              v-if="pendingPhoto || photoError"
              data-testid="creature-photo-clear"
              type="button"
              class="mt-2 text-xs text-dimmed transition-colors hover:text-error"
              @click="clearPendingPhoto"
            >
              取消選取
            </button>

            <!-- 訪客也給得到這一顆：DELETE 刻意沒有那道 403（見 removeOwnedCreaturePhoto） -->
            <button
              v-else-if="canRemovePhoto"
              data-testid="creature-photo-remove"
              type="button"
              class="mt-2 text-xs text-dimmed transition-colors hover:text-error"
              @click="removePhoto"
            >
              移除照片
            </button>
          </div>
        </div>

        <p
          v-if="photoError"
          data-testid="creature-photo-error"
          role="alert"
          class="mt-3 text-sm text-error"
        >
          {{ photoError }}
        </p>
      </div>

      <div
        data-testid="creature-profile-field"
        data-field="name"
      >
        <label
          for="creature-name-input"
          class="flex items-center gap-2 text-sm font-medium"
        >
          俗名
          <span class="rounded px-1.5 py-0.5 text-xs font-semibold text-warning ring-1 ring-warning/40">必填</span>
        </label>
        <UInput
          id="creature-name-input"
          v-model="form.name"
          name="name"
          required
          placeholder="火焰仙"
          autocomplete="off"
          class="mt-2 w-full"
        />
      </div>

      <div
        data-testid="creature-profile-field"
        data-field="scientificName"
      >
        <label
          for="creature-scientific-name"
          class="block text-sm font-medium"
        >學名</label>
        <CreatureSuggestInput
          id="creature-scientific-name"
          v-model="form.scientificName"
          name="scientificName"
          placeholder="輸入俗名或學名，例：火焰仙"
          :items="speciesItems"
          class="mt-2"
          @select="chooseSpecies"
        />
        <p class="mt-1 text-xs text-dimmed">
          可用俗名搜尋，也可以直接輸入清單以外的學名
        </p>
      </div>

      <fieldset
        data-testid="creature-profile-field"
        data-field="category"
      >
        <legend class="flex items-center gap-2 text-sm font-medium">
          分類
          <span class="rounded px-1.5 py-0.5 text-xs font-semibold text-warning ring-1 ring-warning/40">必填</span>
        </legend>
        <div
          class="mt-2 grid grid-cols-3 gap-2"
          role="group"
          aria-label="生物分類"
        >
          <button
            v-for="option in CREATURE_CATEGORY_OPTIONS"
            :key="option.key"
            data-testid="creature-category-option"
            type="button"
            :data-category="option.key"
            :aria-pressed="form.category === option.key ? 'true' : 'false'"
            class="h-11 rounded-lg border text-sm font-medium transition-colors"
            :class="form.category === option.key
              ? 'border-primary bg-primary text-inverted'
              : 'border-default bg-elevated/40 text-muted'"
            @click="chooseCategory(option.key)"
          >
            {{ option.label }}
          </button>
        </div>
      </fieldset>

      <div
        data-testid="creature-profile-field"
        data-field="subCategory"
      >
        <label
          for="creature-sub-category"
          class="block text-sm font-medium"
        >細分類</label>
        <CreatureSuggestInput
          id="creature-sub-category"
          v-model="form.subCategory"
          name="subCategory"
          placeholder="神仙"
          :items="subCategoryItems"
          class="mt-2"
          @select="form.subCategory = $event.value"
        />
      </div>

      <div
        data-testid="creature-profile-field"
        data-field="addedOn"
      >
        <label
          for="creature-added-on-input"
          class="flex items-center gap-2 text-sm font-medium"
        >
          入缸日
          <span class="rounded px-1.5 py-0.5 text-xs font-semibold text-warning ring-1 ring-warning/40">必填</span>
        </label>
        <UInput
          id="creature-added-on-input"
          v-model="form.addedOn"
          name="addedOn"
          type="date"
          required
          :max="today"
          class="mt-2 w-full"
        />
      </div>

      <div
        data-testid="creature-profile-field"
        data-field="price"
      >
        <label
          for="creature-price"
          class="block text-sm font-medium"
        >購入價</label>
        <UInput
          id="creature-price"
          v-model="form.price"
          name="price"
          type="number"
          inputmode="decimal"
          min="0"
          step="0.01"
          placeholder="0"
          class="mt-2 w-full"
        >
          <template #trailing>
            <span class="text-xs text-dimmed">元</span>
          </template>
        </UInput>
      </div>

      <p
        v-if="visibleError"
        data-testid="creature-profile-error"
        role="alert"
        class="text-sm text-error"
      >
        {{ visibleError }}
      </p>

      <div class="pt-1">
        <UButton
          data-testid="creature-profile-submit"
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
        <p
          v-if="!canSubmit"
          class="mt-2 text-center text-xs text-dimmed"
        >
          請填寫俗名、分類與入缸日
        </p>
      </div>
    </form>
  </section>
</template>
