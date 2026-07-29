<script setup lang="ts">
import type { CreateTankResponse } from '#shared/types/tank'
import { TANK_COLOR_OPTIONS, parseTankInput } from '#shared/utils/tankForm'

useSeoMeta({
  title: '新增缸 · ReefLog',
})

// 表單狀態一律以字串持有，送出前才交給 parseTankInput 正規化——
// 「留白」與「填了 0」在字串上是兩件事，轉成 number 就分不出來了。
const form = reactive({
  name: '',
  sizeSpec: '',
  volumeLiters: '',
  setupType: '',
  colorHex: TANK_COLOR_OPTIONS[0]!.hex,
})

const error = ref<string | null>(null)
const submitting = ref(false)

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
  <section class="mx-auto max-w-2xl px-4 py-6">
    <header class="flex items-center gap-2">
      <UButton
        to="/"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        aria-label="返回首頁"
        class="-ml-2 shrink-0"
      />

      <h1 class="text-2xl font-semibold">
        新增缸
      </h1>
    </header>

    <p class="mt-2 text-sm text-muted">
      只有缸名是必填的，其餘之後都能再補。
    </p>

    <!--
      novalidate：required 留著給輔助技術用，但錯誤訊息一律走 parseTankInput，
      不讓瀏覽器的原生泡泡與我們自己的訊息各說各話。
    -->
    <form
      data-testid="tank-form"
      class="mt-6 space-y-5"
      novalidate
      @submit.prevent="submit"
    >
      <div>
        <label
          for="tank-name"
          class="block text-sm font-medium"
        >
          缸名
          <span
            aria-hidden="true"
            class="text-primary"
          >*</span>
        </label>

        <UInput
          id="tank-name"
          v-model="form.name"
          name="name"
          required
          placeholder="例：主缸"
          autocomplete="off"
          class="mt-1.5 w-full"
        />
      </div>

      <div>
        <label
          for="tank-size-spec"
          class="block text-sm font-medium"
        >尺寸</label>

        <UInput
          id="tank-size-spec"
          v-model="form.sizeSpec"
          name="sizeSpec"
          placeholder="例：4 尺"
          autocomplete="off"
          class="mt-1.5 w-full"
        />
      </div>

      <div>
        <label
          for="tank-volume"
          class="block text-sm font-medium"
        >水量（公升）</label>

        <UInput
          id="tank-volume"
          v-model="form.volumeLiters"
          name="volumeLiters"
          type="number"
          inputmode="numeric"
          min="1"
          placeholder="例：420"
          class="mt-1.5 w-full"
        />
      </div>

      <div>
        <label
          for="tank-setup-type"
          class="block text-sm font-medium"
        >飼養型態</label>

        <UInput
          id="tank-setup-type"
          v-model="form.setupType"
          name="setupType"
          placeholder="例：SPS MIXED"
          autocomplete="off"
          class="mt-1.5 w-full"
        />
      </div>

      <fieldset>
        <legend class="text-sm font-medium">
          代表色
        </legend>

        <p class="mt-1 text-xs text-dimmed">
          頁首色塊與缸切換選單用它分辨是哪個缸。
        </p>

        <div class="mt-2.5 flex flex-wrap gap-3">
          <button
            v-for="option in TANK_COLOR_OPTIONS"
            :key="option.hex"
            data-testid="tank-color-option"
            type="button"
            :data-color="option.hex"
            :aria-label="option.label"
            :aria-pressed="form.colorHex === option.hex ? 'true' : 'false'"
            class="size-9 rounded-full ring-offset-2 ring-offset-default transition-shadow"
            :class="form.colorHex === option.hex ? 'ring-2 ring-inverted' : ''"
            :style="{ backgroundColor: option.hex }"
            @click="form.colorHex = option.hex"
          />
        </div>
      </fieldset>

      <p
        v-if="error"
        data-testid="tank-form-error"
        role="alert"
        class="text-sm text-error"
      >
        {{ error }}
      </p>

      <UButton
        data-testid="tank-form-submit"
        type="submit"
        color="primary"
        block
        :loading="submitting"
        class="rounded-full py-2.5"
      >
        建立
      </UButton>
    </form>
  </section>
</template>
