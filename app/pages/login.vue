<script setup lang="ts">
// 登入畫面（issue #47 第 4 節的截圖）。「目前僅提供 Google 登入與訪客登入」。
//
// 不套預設 layout：還沒登入的人沒有缸可看，底部那五個 tab 按了也到不了任何地方，
// 截圖上也確實沒有它。代價是深色外框與滿版高度要自己來（見下方根元素）。
definePageMeta({
  layout: false,
})

useSeoMeta({
  title: '登入 · ReefLog',
})

// ⚠ 兩顆按鈕指向的是「server 路由」，不是前端路由——OAuth 的起點與訪客 session 的
// 建立都必須整頁導出去，交給 vue-router 接手只會變成前端找不到頁面。因此一律 external。
//
// 這兩條路由目前「尚未存在」：它們屬於 `nuxt-auth-utils`，而依 CLAUDE.md 新增套件
// 依賴需要人類核准，本輪不自行安裝。路徑先照該套件的慣例定下來（`/auth/<provider>`），
// 套件裝上、Google client id / secret 與 session 密鑰設好之後即可接上。
const GOOGLE_START = '/auth/google'
const GUEST_START = '/auth/guest'
</script>

<template>
  <div
    data-testid="login-screen"
    class="dark flex min-h-dvh flex-col bg-default px-6 text-default"
  >
    <div class="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
      <div class="flex flex-col items-center text-center">
        <!-- App 標記：圓角方塊裡一個主色方塊（截圖中央的那一格） -->
        <div
          class="flex size-28 items-center justify-center rounded-[1.75rem] bg-primary/10 ring-1 ring-primary/20"
          aria-hidden="true"
        >
          <span class="size-11 rounded-xl bg-primary" />
        </div>

        <p
          data-testid="login-brand"
          class="mt-8 text-sm font-semibold tracking-[0.3em] text-dimmed"
        >
          REEFLOG · 礁記
        </p>

        <h1 class="mt-4 text-3xl font-bold">
          記錄你的海水缸
        </h1>

        <p
          data-testid="login-lead"
          class="mt-4 text-base leading-8 text-muted"
        >
          水質、生物與保養，一站掌握。<br>
          登入以在裝置間同步你的缸。
        </p>
      </div>

      <div class="mt-14 space-y-3">
        <!--
          Google：截圖裡是唯一的實心亮色按鈕。data-emphasis 標出主 / 次動作，
          讓「主要動作只有一個」這件事驗得起來，不必去比對樣式類別。
        -->
        <UButton
          data-testid="login-action-google"
          data-emphasis="primary"
          :to="GOOGLE_START"
          external
          size="xl"
          block
          class="rounded-2xl bg-white py-3.5 text-base font-semibold text-slate-900 hover:bg-white/90"
        >
          <template #leading>
            <!-- Google 官方的四色 G。lucide 沒有品牌圖示，這裡直接內嵌，不另外裝套件。 -->
            <svg
              class="size-5"
              viewBox="0 0 48 48"
              aria-hidden="true"
              focusable="false"
            >
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
            </svg>
          </template>

          使用 Google 繼續
        </UButton>

        <!-- 訪客：進去看的是 seed 的示範資料（見 prisma/seedUser.ts） -->
        <UButton
          data-testid="login-action-guest"
          data-emphasis="secondary"
          :to="GUEST_START"
          external
          color="neutral"
          variant="outline"
          size="xl"
          block
          icon="i-lucide-user"
          class="rounded-2xl py-3.5 text-base font-semibold"
        >
          以訪客身分瀏覽
        </UButton>
      </div>
    </div>

    <!--
      條款與隱私政策目前沒有對應的頁面，也還沒決定要放哪裡，所以先只做強調樣式、
      不連到任何地方——連到不存在的網址比不連更糟。
    -->
    <p
      data-testid="login-terms"
      class="pb-10 text-center text-xs text-dimmed"
    >
      繼續即代表你同意<span class="text-muted">服務條款</span>與<span class="text-muted">隱私政策</span>
    </p>
  </div>
</template>
