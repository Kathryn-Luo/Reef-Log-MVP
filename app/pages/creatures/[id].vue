<script setup lang="ts">
// 生物詳情的內容由對應子 issue 實作，這裡只放「子頁面仍保留底部 tab 列」所需的骨架。
const route = useRoute()

useSeoMeta({
  title: '生物詳情 · ReefLog',
})
</script>

<template>
  <section class="mx-auto max-w-2xl px-4 py-6">
    <NuxtLink
      to="/creatures"
      aria-label="返回生物列表"
      class="inline-flex items-center gap-1 text-muted"
    >
      <UIcon
        name="i-lucide-arrow-left"
        class="size-5"
      />
      <span>返回</span>
    </NuxtLink>

    <h1 class="mt-4 text-2xl font-semibold">
      生物詳情
    </h1>
    <p class="mt-2 text-muted">
      {{ route.params.id }} 的詳細資料由對應子 issue 實作。
    </p>
  </section>
</template>
