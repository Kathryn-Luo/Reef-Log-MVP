<script setup lang="ts">
import type { CreateTankResponse } from '#shared/types/tank'
import { TANK_COLOR_OPTIONS, parseTankInput } from '#shared/utils/tankForm'

useSeoMeta({
  title: '新增缸 · ReefLog',
})

// 表單狀態一律以字串持有，送出前才交給 parseTankInput 正規化——
// 「留白」與「填了 0」在字串上是兩件事，轉成 number 就分不出來了。
//
// 代表色預設為空：設計稿的新增缸畫面左上角是一個空的虛線色塊，
// 六個圓點也都沒有選中環。除缸名外皆可留空，代表色不例外。
const form = reactive({
  name: '',
  colorHex: '',
  sizeSpec: '',
  volumeLiters: '',
  setupType: '',
  startedOn: '',
})

const error = ref<string | null>(null)
const submitting = ref(false)

/** 色票與自訂色碼是同一個值的兩種填法，比對前一律轉小寫 */
const selectedColor = computed(() => form.colorHex.trim().toLowerCase())

// 設計稿：缸名為空時「儲存」disabled。只打空白不算填了缸名——
// 送出後也會被 parseTankInput 擋掉，兩邊的判準必須一致。
const canSubmit = computed(() => form.name.trim().length > 0)

// disabled 的按鈕按不動，但表單仍可能被 Enter 送出，所以這裡不看 canSubmit，
// 一律交給 parseTankInput 判斷並產生訊息
async function submit() {
  const parsed = parseTankInput(form)

  if (!parsed.ok) {
    error.value = parsed.message
    return
  }

  error.value = null
  submitting.value = true

  try {
    const { tank } = await $fetch<CreateTankResponse>('/api/tanks', {
      method: 'POST',
      body: parsed.value,
    })

    // 帶著新缸的 id 導回首頁，讓它成為當前缸。新缸的 displayOrder 最大，
    // 不指名的話首頁預設看的會是排序第一個的舊缸。
    await navigateTo({ path: '/', query: { tank: tank.id } })
  }
  catch {
    error.value = '建立失敗，請稍後再試。'
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="mx-auto max-w-2xl pb-10">
    <!-- 標題列：返回 · 代表色預覽 · 標題 · 儲存（設計稿的頂部橫列） -->
    <header
      class="sticky top-0 z-10 flex items-center gap-3 border-b border-default bg-default px-4 py-3"
    >
      <UButton
        to="/"
        icon="i-lucide-chevron-left"
        color="neutral"
        variant="outline"
        aria-label="返回首頁"
        class="shrink-0 rounded-full"
      />

      <!--
        選色的結果即時反映在這裡，讓使用者先看到這個缸在切換選單中長什麼樣。
        還沒選色時是一格虛線空框，而不是預先幫他挑一個顏色。
      -->
      <span
        data-testid="tank-color-preview"
        :data-color="selectedColor || undefined"
        class="size-7 shrink-0 rounded-lg"
        :class="selectedColor ? '' : 'border border-dashed border-muted'"
        :style="selectedColor ? { backgroundColor: selectedColor } : undefined"
        aria-hidden="true"
      />

      <h1 class="min-w-0 flex-1 truncate text-xl font-semibold">
        新增缸
      </h1>

      <!--
        標題列的儲存在 form 外面，用 @click 直接叫 submit()，
        不靠 form 屬性把送出事件遞進去——少一層瀏覽器行為的假設。
      -->
      <UButton
        data-testid="tank-header-submit"
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

    <!--
      novalidate：required 留著給輔助技術用，但錯誤訊息一律走 parseTankInput，
      不讓瀏覽器的原生泡泡與我們自己的訊息各說各話。
    -->
    <form
      id="tank-form"
      data-testid="tank-form"
      class="space-y-7 px-4 pt-6"
      novalidate
      @submit.prevent="submit"
    >
      <div
        data-testid="tank-field"
        data-field="name"
      >
        <label
          for="tank-name"
          class="flex items-center gap-2 text-sm font-medium"
        >
          缸名
          <span
            data-testid="tank-field-required"
            class="rounded px-1.5 py-0.5 text-xs font-semibold text-warning ring-1 ring-warning/40"
          >必填</span>
        </label>

        <UInput
          id="tank-name"
          v-model="form.name"
          name="name"
          required
          placeholder="主缸"
          autocomplete="off"
          class="mt-2 w-full"
        />
      </div>

      <fieldset
        data-testid="tank-field"
        data-field="colorHex"
      >
        <legend class="text-sm font-medium">
          代表色
        </legend>

        <div class="mt-2.5 flex flex-wrap items-center gap-3">
          <button
            v-for="option in TANK_COLOR_OPTIONS"
            :key="option.hex"
            data-testid="tank-color-option"
            type="button"
            :data-color="option.hex"
            :aria-label="option.label"
            :aria-pressed="selectedColor === option.hex ? 'true' : 'false'"
            class="size-10 rounded-full ring-offset-4 ring-offset-default transition-shadow"
            :class="selectedColor === option.hex ? 'ring-2 ring-inverted' : ''"
            :style="{ backgroundColor: option.hex }"
            @click="form.colorHex = option.hex"
          />
        </div>

        <UInput
          id="tank-color-hex"
          v-model="form.colorHex"
          name="colorHex"
          placeholder="#RRGGBB"
          autocomplete="off"
          aria-label="自訂色碼"
          class="mt-3 w-full"
        >
          <template #trailing>
            <span class="text-xs text-dimmed">自訂色碼</span>
          </template>
        </UInput>

        <p class="mt-1.5 text-xs text-dimmed">
          頁首色塊與缸切換選單用它分辨是哪個缸。
        </p>
      </fieldset>

      <div
        data-testid="tank-field"
        data-field="sizeSpec"
      >
        <label
          for="tank-size-spec"
          class="flex items-baseline gap-2 text-sm font-medium"
        >
          尺寸標示
          <span class="text-xs font-normal text-dimmed">自由填寫</span>
        </label>

        <UInput
          id="tank-size-spec"
          v-model="form.sizeSpec"
          name="sizeSpec"
          placeholder="4 尺"
          autocomplete="off"
          class="mt-2 w-full"
        />
      </div>

      <div
        data-testid="tank-field"
        data-field="volumeLiters"
      >
        <label
          for="tank-volume"
          class="block text-sm font-medium"
        >水量</label>

        <UInput
          id="tank-volume"
          v-model="form.volumeLiters"
          name="volumeLiters"
          type="number"
          inputmode="numeric"
          min="1"
          placeholder="420"
          class="mt-2 w-full"
        >
          <template #trailing>
            <span class="text-xs text-dimmed">公升 / L</span>
          </template>
        </UInput>
      </div>

      <div
        data-testid="tank-field"
        data-field="setupType"
      >
        <label
          for="tank-setup-type"
          class="block text-sm font-medium"
        >飼養型態</label>

        <UInput
          id="tank-setup-type"
          v-model="form.setupType"
          name="setupType"
          placeholder="SPS MIXED"
          autocomplete="off"
          class="mt-2 w-full"
        />

        <p class="mt-1.5 text-xs text-dimmed">
          例如 SPS MIXED、軟體、FOWLR
        </p>
      </div>

      <div
        data-testid="tank-field"
        data-field="startedOn"
      >
        <label
          for="tank-started-on"
          class="block text-sm font-medium"
        >開缸日期</label>

        <UInput
          id="tank-started-on"
          v-model="form.startedOn"
          name="startedOn"
          type="date"
          class="mt-2 w-full"
        />

        <p class="mt-1.5 text-xs text-dimmed">
          作為缸齡計算依據 · 可留空
        </p>
      </div>

      <p
        v-if="error"
        data-testid="tank-form-error"
        role="alert"
        class="text-sm text-error"
      >
        {{ error }}
      </p>

      <div class="pt-1">
        <UButton
          data-testid="tank-form-submit"
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
          data-testid="tank-form-hint"
          class="mt-2 text-center text-xs text-dimmed"
        >
          請先填寫缸名
        </p>
      </div>
    </form>
  </section>
</template>
