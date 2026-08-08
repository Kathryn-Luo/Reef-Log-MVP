<script setup lang="ts">
// 訪客的示範資料還在複製時的共用區塊（issue #144）。
//
// 為什麼抽成元件而不是各頁各寫一份：複製要 11.5 秒，而使用者在那段時間可以走動。
// 五頁若各寫一份文案，下一次只會改到其中一份，而使用者切個 tab 就會看到兩種說法。
// 與 LoadErrorState.vue 同一個理由。
//
// 這一段跟載入骨架刻意**不一樣**：骨架撐十幾秒，使用者分不出「在跑」與「當掉了」。
// 所以這裡有一句話講明在做什麼，而且**沒有任何連出去的入口**——尤其不能有
// 「建立我的第一個缸」，那顆按鈕在這一刻按下去，等於在示範資料落地的路上多插一個空缸。

withDefaults(defineProps<{
  /**
   * 「正在為你準備示範資料」這行字要用哪個標籤。
   *
   * 預設 h1：首頁與生物庫存頁的這一區會整頁取代掉內容，那一刻它是頁面上唯一的標題。
   * 但 /log、/trends、/maintenance 的頁首標題是常駐的 h1，這裡再給一個就變成同一頁
   * 兩個 h1，所以那幾頁傳 'p'——與 LoadErrorState 的 titleTag 同一個作法。
   */
  titleTag?: 'h1' | 'p'
}>(), { titleTag: 'h1' })
</script>

<template>
  <div
    data-testid="sandbox-preparing"
    role="status"
    class="px-4 py-16 text-center"
  >
    <div
      class="mx-auto grid size-20 place-items-center rounded-full border border-dashed border-primary/40"
      aria-hidden="true"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-8 animate-spin text-primary motion-reduce:animate-none"
      />
    </div>

    <component
      :is="titleTag"
      data-testid="sandbox-preparing-title"
      class="mt-6 text-2xl font-semibold"
    >
      正在為你準備示範資料
    </component>

    <p class="mx-auto mt-3 max-w-xs text-balance text-muted">
      我們正在複製一份示範缸給你，這需要幾秒鐘。完成後這裡就會出現水質、生物與保養記錄。
    </p>
  </div>
</template>
