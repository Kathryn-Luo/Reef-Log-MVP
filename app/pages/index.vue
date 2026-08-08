<script setup lang="ts">
import type { GuestSandboxResponse } from '#shared/types/guestSandbox'
import type { CreatureCategoryKey, TankHomeData, TankOption } from '#shared/types/home'
import {
  CREATURE_CATEGORY_LABELS,
  CREATURE_CATEGORY_ORDER,
  buildCreatureCards,
  countCreaturesByCategory,
} from '#shared/utils/creatureCards'

useSeoMeta({
  title: 'ReefLog',
})

// 空狀態下方的三格預告，對應底部 tab 的三個檢視畫面（#40）
const EMPTY_PREVIEWS = [
  { label: '水質趨勢', icon: 'i-lucide-trending-up' },
  { label: '生物庫存', icon: 'i-lucide-circle' },
  { label: '保養提醒', icon: 'i-lucide-diamond' },
] as const

// 「· 4h」與「存活 · N 月」都是相對現在的推算值。整頁共用同一個時間點，
// 摘要列與卡片才不會各自抓到差一秒的基準。
const now = new Date()

// $api 而不是裸 $fetch：session 過期時要被帶去登入頁，而不是停在一頁空資料上（#67）
const { $api } = useNuxtApp()

// 建立缸的表單會帶著 ?tank=<id> 導回來，讓剛建立的那個缸成為當前缸——
// 新缸的 displayOrder 最大，不指名的話看到的會是排序第一個的舊缸。
const route = useRoute()
const selectedTankId = ref<string | null>(
  typeof route.query.tank === 'string' ? route.query.tank : null,
)

/**
 * 缸清單與該缸的內容串成同一個請求鏈，而不是兩個各自的 useAsyncData（issue #110）。
 *
 * 拆成兩個的話，缸清單拿到之後、缸內容還沒發出去之前會有一拍「已完成但沒有資料」，
 * 畫面就會閃一次「還沒有任何缸」——而那個空狀態的唯一出口是「建立我的第一個缸」，
 * 照著按下去就多一個不需要的缸。併成一個之後 status 只有 pending → success 兩種樣子。
 * 與 /trends、/log、/maintenance 同一個作法。
 *
 * lazy 而且**不 await**：這一頁自己畫得出載入樣態，不該在 setup 階段擋著整頁不渲染。
 * #84 之後是 SPA，await 的代價就是整頁空白到資料回來為止——那正是 #110 的問題本身。
 */
const { data, status, refresh: reload } = useAsyncData('home', async () => {
  const { tanks } = await $api<{ tanks: TankOption[] }>('/api/tanks')

  // 未選擇時看的是清單第一個，也就是 schema 定義的「預設缸」
  const tank = tanks.find(candidate => candidate.id === selectedTankId.value) ?? tanks[0] ?? null

  return {
    tanks,
    tank,
    page: tank ? await $api<TankHomeData>(`/api/tanks/${tank.id}/home`) : null,
  }
}, { lazy: true, watch: [selectedTankId] })

const tanks = computed(() => data.value?.tanks ?? [])

/**
 * 此刻頁首該顯示哪一個缸。
 *
 * ⚠ 先看 `selectedTankId`，再退回請求鏈算出來的那一個。
 *
 * 只看 `data.value.tank` 的話，換缸之後頁首會停在**舊缸**直到兩支串接的請求都回來
 * ——選單關了、儀表板收了，但缸名、色塊與水質數字全是上一個缸的。使用者會以為
 * 沒點到而再點一次。缸清單在手上就算得出新缸是哪一個，沒有理由等。
 */
const currentTank = computed(() =>
  data.value?.tanks.find(tank => tank.id === selectedTankId.value)
  ?? data.value?.tank
  ?? null,
)

const home = computed(() => data.value?.page ?? null)

// issue #132：請求失敗時 data 是 null，與「成功但沒有缸」長得一模一樣。
// 少了這一態，「拿不到資料」會被畫成「你沒有資料」，而那個空狀態的唯一出口
// 是「建立我的第一個缸」——照著按下去就多一個不需要的缸。
//
// 401 不在此列：那條路由由 $api 的攔截器帶去登入頁（#67），比這裡更早。
const { failed: loadFailed, retrying, retry: retryLoad } = useLoadFailure([status], reload)

/**
 * 骨架只給「第一次、還沒有任何資料」的那一段（issue #110）。
 *
 * 換缸時 data 還在，useAsyncData 會保留上一份——整頁消失再長回來比等一下更難看懂，
 * 與 /trends 換範圍時的處置一致。
 */
const loading = computed(() =>
  !loadFailed.value && !data.value && (status.value === 'idle' || status.value === 'pending'),
)

/**
 * 訪客的示範資料還在複製中（issue #144）。
 *
 * 為什麼首頁得管這件事：複製要 11.5 秒，原本卡在 /auth/guest 的 302 之前，訪客只能
 * 對著登入頁乾等。搬出來之後訪客會**先進到這一頁**，而此刻 `/api/tanks` 回的是空清單
 * ——與「這個帳號真的沒有缸」在畫面上一模一樣。分不開的話，訪客會看到
 * 「建立我的第一個缸」並照著按下去，然後示範資料才突然冒出來。
 *
 * 分辨的方式是問伺服器：POST /api/guest-sandbox 只在「這位使用者欠著一份沙盒」時
 * 才真的複製（冪等鎖見 server/utils/guestSandbox.ts），並回報它做了什麼。
 *
 *   'unknown'   還沒問過。**空清單在這一態也算準備中**——否則從「載入完成、0 個缸」
 *               到「開始準備」之間會閃一次空狀態，等於換個地方犯同樣的錯。
 *   'preparing' 正在複製。畫面上要有明確在跑的訊號，不是一片骨架：這一段長達十幾秒，
 *               看不出在跑的話使用者會以為當掉了。
 *   'settled'   問過了，沒有欠著的沙盒。空清單此刻才真的是「你還沒有缸」。
 *   'failed'    複製失敗。走 LoadErrorState 的重試，不會把人留在空狀態上。
 */
const sandboxState = ref<'unknown' | 'preparing' | 'settled' | 'failed'>('unknown')

/**
 * 補建沙盒這一次請求的時間預算（毫秒）。
 *
 * 這支端點背後是一個 30 秒上限的交易加上 10 秒等連線，所以它**可以**合法地跑很久。
 * 但「跑很久」與「再也不回來」在畫面上長得一樣：少了這個上限，請求掛住時 promise
 * 不會 reject，畫面就永遠停在「正在準備示範資料」，而那一態刻意沒有任何出口。
 * 45 秒 ＝ 端點自己的上限（30 + 10）再加一點餘裕：真的還在跑就別打斷它，
 * 真的死了就要有人說出來。
 */
const SANDBOX_TIMEOUT_MS = 45_000

const tanksEmpty = computed(() => !!data.value && data.value.tanks.length === 0)

const preparing = computed(() =>
  !loadFailed.value && tanksEmpty.value
  && (sandboxState.value === 'unknown' || sandboxState.value === 'preparing'),
)

async function ensureSandbox() {
  sandboxState.value = 'preparing'

  try {
    await $api<GuestSandboxResponse>('/api/guest-sandbox', {
      method: 'POST',
      timeout: SANDBOX_TIMEOUT_MS,
    })

    // ⚠ 不管回的是什麼都要重新取一次，**不能只在 alreadySeeded 為 false 時才取**。
    //
    // 複製可能是別人做的：冪等鎖（server/utils/guestSandbox.ts）保證只有一個呼叫者
    // 真的複製，另一個分頁、或先前一次還在路上的請求，都會拿到 alreadySeeded: true
    // ——而那一刻資料其實已經進來了。只在 false 時重取的話，這一頁會永遠停在
    // 「還沒有任何缸」，而同一時間 /api/tanks 明明回得出缸。
    //
    // 代價是真的沒有缸的帳號（例如 Google 使用者）會多打一次 /api/tanks。
    // 那是一次很便宜的讀取，換掉的是一個沒有出口的死畫面。
    // 實際踩過（PR #145 的 E2E，畫面等了 34 次輪詢仍是空狀態）。
    await reload()

    sandboxState.value = 'settled'
  }
  catch {
    sandboxState.value = 'failed'
  }
}

/**
 * 空清單就問一次伺服器——只問一次。
 *
 * `sandboxState !== 'unknown'` 這道閘門不能省：ensureSandbox 成功時會 reload()，
 * data 因此再變一次，watcher 於是又醒過來。少了它，沙盒真的空著的帳號
 * （模板沒 seed 過的環境）會無限重打這支 API。
 */
watch(data, () => {
  if (tanksEmpty.value && sandboxState.value === 'unknown') {
    void ensureSandbox()
  }
}, { immediate: true })

/**
 * 重新補建一次示範資料。
 *
 * 與整頁的 retryLoad 分開：兩者失敗的東西不同，能給的出路也不同（見下方 showError）。
 * `retryingSandbox` 讓按鈕在請求進行中按不下去——與 useLoadFailure 的 retrying 同一個
 * 用意（#132），少了它同一個 tick 內連點兩下就會送出兩次寫入。
 */
const retryingSandbox = ref(false)

async function retrySandbox() {
  if (retryingSandbox.value) {
    return
  }

  retryingSandbox.value = true

  try {
    await ensureSandbox()
  }
  finally {
    retryingSandbox.value = false
  }
}

/**
 * 整頁給不出內容——**只有取缸清單失敗才算**。
 *
 * ⚠ 補建沙盒失敗不在此列，這是刻意的。
 *
 * LoadErrorState 沒有任何連出去的入口（#132：拿不到資料時給「建立第一個缸」，
 * 人照著按下去就多一個不需要的缸）。把補建失敗也畫成它，代價是**真的沒有缸的人
 * 被鎖在門外**：Google 使用者的缸清單明明拿得到，卻只因為一支訪客專屬的 API 掛了
 * 就完全無法建立第一個缸。那條路徑在 #144 之前不存在。
 *
 * 所以補建失敗降級成一列提示（下方的 sandbox-error），空狀態與它的出口照常顯示。
 * 訪客因此可能在示範資料到齊之前先建一個空缸——那是這個取捨換來的代價，
 * 比把人鎖在門外便宜得多，而且提示本身說得出發生了什麼。
 */
const showError = computed(() => loadFailed.value)

/** 補建失敗：示範資料沒來，但這一頁其餘部分照常運作 */
const sandboxFailed = computed(() => sandboxState.value === 'failed')

const creatures = computed(() => home.value?.creatures ?? [])
const counts = computed(() => countCreaturesByCategory(creatures.value))

// 捲動位置的還原自己做（issue #103）：SPA 下瀏覽器在 load 當下文件只有一個 viewport 高，
// 無處可還原，等資料到齊也不會再回頭補——捲到一半重新整理因此會回到頂端。
const { settled, pending } = useScrollRestore()

// 向下捲動時固定的頁首收合成兩層（缸名列 + 水質單行 pill）。
// animated 是「過場已開放」——還原捲動位置的那一次要直接落在最終樣態，不補播動畫，
// 所以開放的時機要等到 settled（還原已經處理完）之後。
// at 是「樣態要對齊哪個位置」：還原期間頁首要先擺成補回去之後的樣子，
// 否則那一捲之後才收合，抽掉的高度會被 scroll anchoring 從落點上扣回來。
//
// ⚠ until 還要等頁首真的渲染得出來（issue #110）。這一頁改成 lazy 之後，頁首在
// 資料回來之前根本還沒渲染，而 settled 在沒有東西要還原時是 onMounted 當下就 true
// 的——只看 settled 的話，頁首的第一次渲染會發生在過場**已經開放之後**，
// reef-motion-off 那一幀就不存在了，還原捲動位置時會看到頁首演一遍收合（#103）。
//
// 條件是 currentTank 而不是 data：訪客那條路上 data 早就非 null（清單是空的，
// 畫面停在「正在準備」），而頁首要等十幾秒後補建完才第一次出現。看 data 的話
// 閘門會在頁首還不存在時就開啟，那一幀又沒了。
const { collapsed, animated } = useHeaderCollapse({
  until: () => settled.value && !!currentTank.value,
  at: pending,
})

// 數據儀表板（screen-2）的展開狀態。關閉的手勢有三種（✕ / 遮罩 / 下拉把手），
// 狀態放在頁面這一層，三者才是在改同一個開關。
const dashboardOpen = ref(false)

// 換缸時把儀表板收起來：留著的話會變成「新缸的頁首配舊缸的數據」。
//
// 看 selectedTankId 而不是當前那個缸：換缸的手勢就是改這個 ref，而缸的內容要等
// 請求回來才變——盯著後者的話，儀表板會在新資料到達前多開著幾秒，配的正是舊缸的數字。
watch(selectedTankId, () => {
  dashboardOpen.value = false
})

const activeCategory = ref<CreatureCategoryKey | 'ALL'>('ALL')

const chips = computed(() => [
  { key: 'ALL' as const, text: '全部' },
  ...CREATURE_CATEGORY_ORDER.map(category => ({
    key: category,
    text: `${CREATURE_CATEGORY_LABELS[category]} ${counts.value[category]}`,
  })),
])

const cards = computed(() =>
  buildCreatureCards(
    activeCategory.value === 'ALL'
      ? creatures.value
      : creatures.value.filter(creature => creature.category === activeCategory.value),
    now,
  ),
)
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <!--
      補建示範資料失敗（issue #144）。刻意只是一列提示而不是整頁的 LoadErrorState：
      那一態沒有任何出口，會把「建立我的第一個缸」一起拆掉——而缸清單明明是好的。
      真的沒有缸的人（例如 Google 使用者）會因此完全無法建立第一個缸。
    -->
    <div
      v-if="sandboxFailed && !showError"
      data-testid="sandbox-error"
      role="alert"
      class="mx-4 mt-4 flex items-center gap-3 rounded-2xl border border-default bg-elevated/40 px-4 py-3 text-sm"
    >
      <UIcon
        name="i-lucide-cloud-off"
        class="size-5 shrink-0 text-dimmed"
        aria-hidden="true"
      />

      <p class="flex-1 text-muted">
        示範資料準備失敗，你仍然可以自己建立缸。
      </p>

      <UButton
        data-testid="sandbox-error-retry"
        type="button"
        size="sm"
        color="neutral"
        variant="outline"
        :loading="retryingSandbox"
        class="shrink-0 rounded-full"
        @click="retrySandbox"
      >
        重試
      </UButton>
    </div>

    <!-- 拿不到資料。要排在空狀態之前：兩者的 data 都是 null，先問的那一個說了算 -->
    <LoadErrorState
      v-if="showError"
      :retrying="retrying"
      @retry="retryLoad"
    />

    <!--
      資料還在路上時的骨架（issue #110）。#84 之後是 SPA，首屏沒有伺服器算好的畫面，
      直接判斷「有沒有缸」會先閃一次「還沒有任何缸」——而那個空狀態的唯一出口
      是「建立我的第一個缸」，照著按下去就多一個不需要的缸。

      形狀照著下面真正的版面排：固定頁首（缸名列 + 水質摘要卡）、生物標題與分類 chip、
      兩欄生物卡片。與 /trends、/log、/maintenance 同一套樣式。
    -->
    <div
      v-else-if="loading"
      data-testid="home-loading"
      class="space-y-4 px-4 pt-4"
    >
      <div class="h-9 w-40 animate-pulse rounded-2xl bg-elevated/60" />
      <div class="h-32 animate-pulse rounded-2xl bg-elevated/60" />
      <div class="h-8 w-28 animate-pulse rounded-2xl bg-elevated/60" />

      <div class="grid grid-cols-2 gap-3">
        <div
          v-for="placeholder in 4"
          :key="placeholder"
          class="h-40 animate-pulse rounded-2xl bg-elevated/60"
        />
      </div>

      <span class="sr-only">載入中</span>
    </div>

    <!--
      訪客的示範資料還在複製中（issue #144）。

      這一段跟上面的骨架刻意**不一樣**：複製要十幾秒，一片沒有說明的骨架撐那麼久，
      使用者分不出「在跑」與「當掉了」。所以這裡有一句話講明在做什麼，
      而且沒有任何連出去的入口——尤其不能有「建立我的第一個缸」，
      那顆按鈕在這一刻按下去，等於在示範資料落地的路上多插一個空缸。
    -->
    <div
      v-else-if="preparing"
      data-testid="home-preparing"
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

      <p
        data-testid="home-preparing-title"
        class="mt-6 text-2xl font-semibold"
      >
        正在為你準備示範資料
      </p>

      <p class="mx-auto mt-3 max-w-xs text-balance text-muted">
        我們正在複製一份示範缸給你，這需要幾秒鐘。完成後這裡就會出現水質、生物與保養記錄。
      </p>
    </div>

    <div
      v-else-if="!currentTank"
      data-testid="tank-empty"
      class="px-4 py-12 text-center"
    >
      <!-- 設計稿的空缸插圖：虛線缸壁 + 水線 + 中央的加號 -->
      <div
        class="mx-auto grid h-56 w-full max-w-sm place-items-center rounded-3xl border border-dashed border-muted bg-gradient-to-b from-transparent to-primary/5"
        aria-hidden="true"
      >
        <div class="relative flex w-full items-center justify-center">
          <span class="absolute inset-x-0 h-px bg-primary/40" />
          <span class="relative grid size-20 place-items-center rounded-full border border-primary/60 bg-default">
            <UIcon
              name="i-lucide-plus"
              class="size-8 text-primary"
            />
          </span>
        </div>
      </div>

      <h1 class="mt-8 text-3xl font-bold">
        還沒有任何缸
      </h1>

      <p class="mx-auto mt-3 max-w-xs text-balance text-muted">
        建立你的第一個缸，開始記錄水質、追蹤生物與接收保養提醒。
      </p>

      <!-- 空狀態不能只說明「建立之後會怎樣」：這是新使用者唯一的入口（issue #46） -->
      <UButton
        data-testid="tank-empty-action"
        to="/tanks/new"
        icon="i-lucide-plus"
        color="primary"
        size="xl"
        block
        class="mt-8 rounded-2xl py-4 text-base font-semibold"
      >
        建立我的第一個缸
      </UButton>

      <!--
        設計稿在按鈕下方預告三項功能。還沒有缸時它們沒有資料可看，
        點進去只會看到另一個空狀態，所以這裡只呈現、不連出去。
      -->
      <div class="mt-4 grid grid-cols-3 gap-3">
        <button
          v-for="preview in EMPTY_PREVIEWS"
          :key="preview.label"
          data-testid="tank-empty-preview"
          type="button"
          disabled
          class="grid place-items-center gap-2 rounded-2xl border border-default px-2 py-5 text-xs text-dimmed"
        >
          <UIcon
            :name="preview.icon"
            class="size-5"
          />
          {{ preview.label }}
        </button>
      </div>
    </div>

    <template v-else>
      <!--
        向下捲看生物時要一直看得到的兩層：缸名列（我在看哪一缸）與水質 pill（有沒有異常）。
        捲過門檻後兩層一起收合（缸副標與六格數字讓位），固定區從約 236px 縮到約 92px，
        生物卡片的可捲動區域才真的變大——只釘住不收合的話，看起來就只是把整段頁首改成 fixed。

        間距一律給在容器內部：容器若留外距，捲動的卡片會從縫隙穿過去，backdrop blur 就破了。
        z-30 要低於 BottomTabBar 的 z-50（tab 列不能被蓋住），又高於生物卡片（卡片從下方穿過）。
        不能加 overflow-*，否則 TankHeader 的切換缸選單會被裁掉。

        收合是漸變不是瞬變（issue #55）：兩層各自把讓位的那一塊補間到 0 高，
        這裡只補上固定區自己的內距。reef-motion-off 是「這一幀不要動」，
        還原捲動位置（#103）的那一次才不會先展開再演一次收合。
      -->
      <div
        data-testid="home-sticky-header"
        :data-collapsed="collapsed ? 'true' : 'false'"
        :data-animated="animated ? 'true' : 'false'"
        class="sticky top-0 z-30 border-b border-default bg-default/80 backdrop-blur pt-[env(safe-area-inset-top)] transition-[padding] duration-200 ease-out motion-reduce:transition-none"
        :class="[collapsed ? 'pb-2' : 'pb-4', animated ? '' : 'reef-motion-off']"
      >
        <TankHeader
          :tanks="tanks"
          :current-tank-id="currentTank.id"
          :collapsed="collapsed"
          @select="selectedTankId = $event"
        />

        <div
          class="px-4 transition-[margin] duration-200 ease-out motion-reduce:transition-none"
          :class="collapsed ? 'mt-2' : 'mt-4'"
        >
          <WaterSummaryCard
            :water="home?.water ?? null"
            :now="now"
            :collapsed="collapsed"
            @expand="dashboardOpen = true"
          />
        </div>
      </div>

      <section class="mt-6 px-4">
        <div class="flex items-center justify-between gap-3">
          <h2 class="flex items-baseline gap-2 text-2xl font-semibold">
            生物
            <span
              data-testid="creature-total"
              class="text-sm font-normal text-muted"
            >{{ counts.all }} 隻</span>
          </h2>

          <!--
            表單畫面 Epic 中沒有截圖，由另一支 needs-design 的
            「新增 / 編輯生物表單」issue 負責；這裡只渲染按鈕並連向該路由。
          -->
          <UButton
            to="/creatures/new"
            icon="i-lucide-plus"
            color="primary"
            class="shrink-0 rounded-full px-4"
          >
            新增
          </UButton>
        </div>

        <div class="mt-4 flex gap-2 overflow-x-auto pb-1">
          <button
            v-for="chip in chips"
            :key="chip.key"
            data-testid="creature-chip"
            type="button"
            :data-category="chip.key"
            :aria-pressed="activeCategory === chip.key ? 'true' : 'false'"
            class="shrink-0 rounded-full border px-4 py-1.5 text-sm transition-colors"
            :class="activeCategory === chip.key
              ? 'border-primary bg-primary text-inverted font-semibold'
              : 'border-default text-muted'"
            @click="activeCategory = chip.key"
          >
            {{ chip.text }}
          </button>
        </div>

        <div
          v-if="cards.length"
          class="mt-4 grid grid-cols-2 gap-3"
        >
          <CreatureCard
            v-for="card in cards"
            :key="`${card.status}-${card.name}`"
            :card="card"
          />
        </div>

        <p
          v-else
          data-testid="creature-empty"
          class="mt-8 text-center text-muted"
        >
          這個分類還沒有生物。
        </p>
      </section>

      <!--
        點一下水質摘要列升起的數據儀表板（screen-2）。
        放在頁面最後、sticky 頁首之外：它是覆蓋整個畫面的一層，
        留在 sticky 容器裡會被容器的 z-30 壓在底部 tab 列（z-50）之下。
      -->
      <WaterDashboardSheet
        :open="dashboardOpen"
        :tank-name="currentTank.name"
        :water="home?.water ?? null"
        :now="now"
        @close="dashboardOpen = false"
      />
    </template>
  </div>
</template>
