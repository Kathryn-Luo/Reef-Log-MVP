<script setup lang="ts">
// 登入畫面（issue #63，來源為 Epic #47 第 4 節的截圖 00a）。
// 截圖的副標：「目前 Google + 訪客 · 其他方式預留」——所以這一頁刻意只有兩個入口。
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
// 兩顆都帶 rel="nofollow"：這一頁是公開的，而 /auth/guest 是「一次 GET 就建一位 User
// 並複製一整份示範資料」（#66）。#67 之後每一次爬 `/` 都會落在這裡，那顆連結就在爬蟲
// 正前方。另一半在 public/robots.txt——兩道都只是提示，所以兩道都要。
//
// noopener noreferrer 要一起寫上：UButton 對 external 連結本來就會補這兩個值，而
// rel 是整個屬性被覆寫、不是合併——只寫 nofollow 會把它們洗掉。這兩個連結是同源
// 同分頁導向，掉了實際上不痛，但沒有理由留一個自己製造的退步。
//
// 這兩條路由目前「尚未存在」：它們屬於 `nuxt-auth-utils`，而依 CLAUDE.md 新增套件
// 依賴需要人類核准，本輪不自行安裝。路徑先照該套件的慣例定下來（`/auth/<provider>`），
// 套件裝上、Google client id / secret 與 session 密鑰設好之後即可接上。
const GOOGLE_START = '/auth/google'
const GUEST_START = '/auth/guest'

// 條款與隱私政策的內容頁不在本 issue 範圍內（issue 的「非目標」：只做連結樣式與
// placeholder）。路徑先定下來，內容頁補上之前按下去會是 404。
const TERMS = '/terms'
const PRIVACY = '/privacy'

/**
 * 訪客登入已經送出，正在等瀏覽器導向（issue #110）。
 *
 * 這條路徑是整頁導向，導向期間瀏覽器仍然停在這一頁上——所以這個樣態是使用者
 * 這幾秒**唯一**看得到的回饋。#144 之前那是 9～15 秒，之後約 2.8 秒；
 * 「按了沒反應」與長度無關，兩種情況都需要它。
 */
const guestStarting = ref(false)

/**
 * 第一次點擊放行，之後的擋下來。
 *
 * 為什麼是 preventDefault 而不是 `:disabled`：這顆按鈕是連結，導向由瀏覽器處理。
 * 把它 disable 掉會在同一拍改變元素的可互動性，有機會連第一次那一次導向都一起取消，
 * 於是變成「按了完全沒事」——比沒有處理中樣態更糟。
 *
 * 擋第二次是有代價的事：每一次 /auth/guest 都會建一位新訪客（#66），
 * 連點兩下就是兩位訪客、兩份示範資料，而且第二次會把第一次的 session 換掉。
 */
function startGuest(event: MouseEvent) {
  if (guestStarting.value) {
    event.preventDefault()

    return
  }

  guestStarting.value = true
}
</script>

<template>
  <div
    data-testid="login-screen"
    class="dark flex min-h-dvh flex-col bg-default px-6 text-default"
  >
    <div class="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
      <div class="flex flex-col items-center text-center">
        <!--
          App 標記：圓角方塊裡一個主色方塊（截圖中央的那一格）。
          外圈的 shadow 就是截圖上那圈往外散的光暈。
        -->
        <div
          data-testid="login-app-mark"
          class="flex size-28 items-center justify-center rounded-[1.75rem] bg-primary/10 shadow-[0_0_60px_-10px_var(--ui-primary)] ring-1 ring-primary/20"
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

        <!-- 截圖上是分成兩行的兩句話，不是一段折下來的長句，所以斷行寫死 -->
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
          data-starting="false"
          :to="GOOGLE_START"
          external
          rel="nofollow noopener noreferrer"
          size="xl"
          block
          class="rounded-2xl bg-white py-3.5 text-base font-semibold text-slate-900 hover:bg-white/90"
        >
          <template #leading>
            <!-- Google 官方的四色 G。lucide 沒有品牌圖示，這裡直接內嵌，不另外裝套件。 -->
            <svg
              data-testid="login-google-icon"
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

        <!-- 訪客：深底細邊框，在截圖裡明顯是「另一條路」而不是第二個主要動作 -->
        <UButton
          data-testid="login-action-guest"
          data-emphasis="secondary"
          :data-starting="guestStarting ? 'true' : 'false'"
          :to="GUEST_START"
          external
          rel="nofollow noopener noreferrer"
          color="neutral"
          variant="outline"
          size="xl"
          block
          class="rounded-2xl border border-default bg-elevated/40 py-3.5 text-base font-semibold"
          @click="startGuest"
        >
          <!--
            ⚠ 處理中的樣態是自己換圖示，**不能用 UButton 的 `loading` prop**。
            它在 loading 為 true 時會自己把元素 disable 掉，而這顆是連結——
            點下去的同一拍被 disable，瀏覽器會把那次還沒開始的導向一起取消，
            結果是「按了完全沒事」。實際踩過（PR #145，E2E 整批停在 /login）。
          -->
          <template #leading>
            <UIcon
              data-testid="login-guest-icon"
              :name="guestStarting ? 'i-lucide-loader-circle' : 'i-lucide-user'"
              class="size-5"
              :class="guestStarting ? 'animate-spin motion-reduce:animate-none' : ''"
            />
          </template>

          以訪客身分瀏覽
        </UButton>
      </div>
    </div>

    <!--
      條款與隱私政策的內容頁還沒寫（issue 的非目標），但截圖上這兩個詞是被強調出來的，
      驗收條件也要求它們是連結，所以路徑先定下來、樣式照截圖做。

      用原生 <a> 而非 NuxtLink：這一句是連續的一行字，中間不能被斷行擠出空白，
      而 <a> 屬於 inline 元素、不受「多行元素內容要換行」那條 lint 規則管。
    -->
    <p
      data-testid="login-terms"
      class="pb-10 text-center text-xs text-dimmed"
    >
      繼續即代表你同意<a
        :href="TERMS"
        class="text-muted underline-offset-2 hover:underline"
      >服務條款</a>與<a
        :href="PRIVACY"
        class="text-muted underline-offset-2 hover:underline"
      >隱私政策</a>
    </p>
  </div>
</template>
