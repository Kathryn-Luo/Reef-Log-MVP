<script setup lang="ts">
useHead({
  title: 'ReefLog',
})
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col items-center gap-6 px-4 py-24 text-center">
    <UIcon
      name="i-lucide-waves"
      class="size-12 text-primary"
    />
    <h1 class="text-3xl font-bold">
      ReefLog
    </h1>
    <p class="text-muted">
      海水缸記錄工具 — 專案架構建置中。
    </p>
    <UButton
      to="https://github.com/kathryn-luo/reef-log-mvp"
      target="_blank"
      variant="soft"
    >
      查看專案進度
    </UButton>
  </div>
</template>
