<script setup lang="ts">
const tabs = [
  { label: '首頁', to: '/', icon: 'i-lucide-square-square' },
  { label: '記錄', to: '/log', icon: 'i-lucide-plus' },
  { label: '趨勢', to: '/trends', icon: 'i-lucide-trending-up' },
  { label: '生物', to: '/creatures', icon: 'i-lucide-circle' },
  { label: '保養', to: '/maintenance', icon: 'i-lucide-diamond' },
]

const route = useRoute()

// 子頁面（例如生物詳情 /creatures/xxx）仍算在所屬 tab 之下。
// 首頁是唯一例外：'/' 是所有路徑的前綴，只能精準比對。
function isActive(to: string) {
  if (to === '/') {
    return route.path === '/'
  }

  return route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <nav
    aria-label="主要導覽"
    class="fixed inset-x-0 bottom-0 z-50 border-t border-default bg-default/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
  >
    <ul class="mx-auto flex max-w-2xl">
      <li
        v-for="tab in tabs"
        :key="tab.to"
        class="flex-1"
      >
        <NuxtLink
          :to="tab.to"
          :aria-current="isActive(tab.to) ? 'page' : undefined"
          class="flex flex-col items-center gap-1 py-2 transition-colors"
          :class="isActive(tab.to) ? 'text-primary' : 'text-dimmed'"
        >
          <UIcon
            :name="tab.icon"
            class="size-6"
          />
          <span class="text-xs">{{ tab.label }}</span>
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
