<script setup lang="ts">
// 取資料失敗時的共用區塊（issue #132）。
//
// 為什麼需要它：useAsyncData 失敗時 `data` 是 null，而畫面若只分「載入中」與
// 「載入完」兩態，null 就會一路落到空狀態——「拿不到資料」被講成「你沒有資料」。
// 最糟的一條路徑是使用者照著空狀態按下「建立我的第一個缸」，於是多了一個
// 他其實不需要的缸。所以這一區刻意**沒有任何連出去的入口**，只有「重試」。
//
// 為什麼抽成元件而不是各頁各寫一份：三頁的錯誤區塊長得一樣，各寫一份的話
// 下一次只會改到其中一份，文案與行為就會慢慢漂走。

withDefaults(defineProps<{
  /** 重試進行中。按鈕轉圈並按不下去，連按不會疊出好幾輪同樣的請求 */
  retrying?: boolean
  /**
   * 「載入失敗」這行字要用哪個標籤。
   *
   * 預設 h1：首頁與生物庫存頁的錯誤區塊會整頁取代掉內容，那一刻它是頁面上唯一的標題。
   * 但 /log 的頁首「記錄水質」是常駐的 h1，錯誤區塊再給一個就變成同一頁兩個 h1，
   * 所以那一頁傳 'p'——那也正是該頁自己的空狀態早就在做的事。
   */
  titleTag?: 'h1' | 'p'
}>(), { retrying: false, titleTag: 'h1' })

defineEmits<{ retry: [] }>()
</script>

<template>
  <div
    data-testid="load-error"
    role="alert"
    class="px-4 py-12 text-center"
  >
    <div
      class="mx-auto grid size-20 place-items-center rounded-full border border-dashed border-muted"
      aria-hidden="true"
    >
      <UIcon
        name="i-lucide-cloud-off"
        class="size-8 text-dimmed"
      />
    </div>

    <component
      :is="titleTag"
      data-testid="load-error-title"
      class="mt-6 text-2xl font-semibold"
    >
      載入失敗
    </component>

    <!--
      這段話要同時說兩件事：拿不到的是「這一次的連線」，以及「你的記錄還在」。
      少了後半句，畫面看起來仍然像是資料不見了。
    -->
    <p
      data-testid="load-error-description"
      class="mx-auto mt-3 max-w-xs text-balance text-muted"
    >
      拿不到資料，可能是連線或伺服器出了狀況。你的記錄都還在，稍後再試一次即可。
    </p>

    <UButton
      data-testid="load-error-retry"
      type="button"
      icon="i-lucide-rotate-cw"
      color="primary"
      size="xl"
      :loading="retrying"
      class="mt-8 rounded-2xl px-6 py-3 text-base font-semibold"
      @click="$emit('retry')"
    >
      重試
    </UButton>
  </div>
</template>
