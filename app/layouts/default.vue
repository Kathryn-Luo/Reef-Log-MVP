<template>
  <div
    data-app-shell
    class="dark min-h-dvh bg-default text-default"
  >
    <!-- pb 需容納 tab 列本身的高度加安全區域，內容才不會被固定的 tab 列蓋住 -->
    <main class="pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
      <slot />
    </main>

    <BottomTabBar />
  </div>
</template>
