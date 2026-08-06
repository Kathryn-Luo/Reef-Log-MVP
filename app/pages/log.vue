<script setup lang="ts">
import type { TankOption, WaterParameterKey } from '#shared/types/home'
import type { CreateWaterLogResponse, WaterLogPageData, WaterLogRequest } from '#shared/types/waterLog'
import { MISSING_READING_TEXT, WATER_PARAMETER_ORDER } from '#shared/utils/waterQuality'
import {
  EMPTY_READINGS_MESSAGE,
  INVALID_MEASURED_AT_MESSAGE,
  buildReadingFields,
  buildWaterLogRows,
  composeMeasuredAt,
  defaultMeasuredAtInput,
  mergePreviousReadings,
  readingFieldError,
} from '#shared/utils/waterLog'
import { apiErrorMessage } from '#shared/utils/apiError'

// 記錄水質（Epic #1 screen-3，issue #124 ＝ #11 的畫面那一半）。
//
// 資料那一半是 #121 / PR #127：GET 給「前次讀值 + 歷史」，POST 回傳剛寫進去的那一筆。
// 欄位規則與畫面上算得出來的東西都在 #shared/utils/waterLog（與 API 共用同一份）。

useSeoMeta({
  title: '記錄水質 · ReefLog',
})

// 歷史每一列的「4 天前」是相對現在的推算值。整頁共用同一個時間點，
// 各列才不會各自抓到差一秒的基準。
const now = new Date()

const router = useRouter()

// $api 而不是裸 $fetch：session 過期時要被帶去登入頁，而不是停在一頁空資料上（#67）
const { $api } = useNuxtApp()

/**
 * 缸與水質記錄串成同一個請求鏈，而不是兩個各自的 useAsyncData。
 *
 * 理由是驗收條件那條「不得先閃一次空狀態」：拆成兩個的話，缸拿到之後、記錄還沒
 * 發出去之前會有一拍「已完成但沒有資料」，畫面就會閃一次「還沒有任何記錄」。
 * 併成一個之後，status 只有 pending → success 兩種樣子。
 *
 * lazy：這一頁自己畫得出載入樣態，所以不在 setup 階段擋著整頁不渲染。
 */
const { data, status, refresh: reload } = useAsyncData('water-log', async () => {
  const { tanks } = await $api<{ tanks: TankOption[] }>('/api/tanks')

  // 未指定時看的是清單第一個，也就是 schema 定義的「預設缸」（與生物庫存頁一致）
  const tank = tanks[0] ?? null

  return {
    tank,
    page: tank ? await $api<WaterLogPageData>(`/api/tanks/${tank.id}/water-logs`) : null,
  }
}, { lazy: true })

/**
 * issue #132：請求失敗時 data 是 null，與「成功但沒有缸」長得一模一樣。
 * 少了這一態，「拿不到資料」會被畫成「你沒有資料」，而這一頁的空狀態唯一的出口
 * 是「建立我的第一個缸」——照著按下去就多一個不需要的缸，三頁裡最糟的一條。
 *
 * 401 不在此列：那條路由由 $api 的攔截器帶去登入頁（#67），比這裡更早。
 *
 * 只有一支 status：缸與水質記錄本來就串成同一個請求鏈（見上方），
 * 所以重試也只有一個 reload，兩段一起重打。
 */
const { failed: loadFailed, retrying, retry: retryLoad } = useLoadFailure([status], reload)

// 失敗（含重試進行中）不算載入中：骨架排在錯誤區塊之後的話，重試的那一段會把
// 錯誤區塊換成骨架，再次失敗時中間那一拍就成了「什麼都沒說」。
const loading = computed(() =>
  !loadFailed.value && (status.value === 'idle' || status.value === 'pending'),
)
const tank = computed(() => data.value?.tank ?? null)

const subtitle = computed(() =>
  tank.value ? [tank.value.name, tank.value.sizeSpec].filter(Boolean).join(' · ') : '',
)

// 「上次 8.0」一律取 previousReadings：歷史有筆數上限，從那份清單推導的話，
// 某個測項上一次量測落在截斷之外時那一格會憑空消失（issue #124 第 3 節）。
const fields = computed(() => buildReadingFields(data.value?.page?.previousReadings ?? []))
const rows = computed(() => buildWaterLogRows(data.value?.page?.waterLogs ?? [], now))

// 表單狀態一律以字串持有：「留白」與「填了 0」在字串上是兩件事，
// 轉成 number 就分不出來了（與 app/pages/tanks/new.vue 同一個作法）。
const readings = reactive(
  Object.fromEntries(WATER_PARAMETER_ORDER.map(parameter => [parameter, ''])) as Record<WaterParameterKey, string>,
)

/** 每一欄的錯誤訊息，空字串代表這一欄沒問題（六個 key 一直都在，不動態增刪） */
const fieldErrors = reactive(
  Object.fromEntries(WATER_PARAMETER_ORDER.map(parameter => [parameter, ''])) as Record<WaterParameterKey, string>,
)
const measuredDate = ref('')
const measuredTime = ref('')
const error = ref<string | null>(null)
const submitting = ref(false)

/** 日期欄預設今天、時間欄預設現在。存檔成功後也重設回「現在」 */
function resetMeasuredAt() {
  const defaults = defaultMeasuredAtInput(new Date())

  measuredDate.value = defaults.date
  measuredTime.value = defaults.time
}

resetMeasuredAt()

/**
 * 失焦時驗這一欄（驗收條件明文要求），輸入中不打斷——
 * 打到一半的「7.」在規則上不合法，跳出來只會擋住還在打字的人。
 */
function validateField(parameter: WaterParameterKey) {
  fieldErrors[parameter] = readingFieldError(readings[parameter]) ?? ''
}

const GENERIC_ERROR = '儲存失敗，請稍後再試。'
const FIELD_ERROR = '請先修正標示的欄位。'

async function submit() {
  const target = tank.value

  if (!target || submitting.value) {
    return
  }

  // 六欄全部再驗一次：一格都沒點過就直接按儲存的話，失焦那一輪根本沒發生過
  for (const parameter of WATER_PARAMETER_ORDER) {
    validateField(parameter)
  }

  if (WATER_PARAMETER_ORDER.some(parameter => fieldErrors[parameter])) {
    error.value = FIELD_ERROR
    return
  }

  // 畫面上的日期與時間是當地的牆上時間，送出前換成帶 offset 的量測瞬間
  const measuredAt = composeMeasuredAt(measuredDate.value, measuredTime.value)

  if (!measuredAt) {
    error.value = INVALID_MEASURED_AT_MESSAGE
    return
  }

  // 未填的測項整個不送：server 會把它視為「未量測」，不建立那一列
  const filled: WaterLogRequest['readings'] = {}

  for (const parameter of WATER_PARAMETER_ORDER) {
    const text = readings[parameter].trim()

    if (text) {
      filled[parameter] = text
    }
  }

  // server 也會擋（400「至少填寫一項讀值。」），但這一趟往返沒有意義
  if (!Object.keys(filled).length) {
    error.value = EMPTY_READINGS_MESSAGE
    return
  }

  error.value = null
  submitting.value = true

  try {
    const { waterLog } = await $api<CreateWaterLogResponse>(`/api/tanks/${target.id}/water-logs`, {
      method: 'POST',
      body: { measuredAt, readings: filled },
    })

    const current = data.value

    // 回應帶著剛寫進去的那一筆（含 id 與正規化後的 measuredAt），
    // 所以直接插進本地清單即可，不必整包重抓。
    //
    // 整個換掉而不是改 current.page：useAsyncData 的 data 預設是 shallowRef，
    // 只動裡面一層的話畫面不會跟著更新。
    if (current?.page) {
      data.value = {
        tank: current.tank,
        page: {
          previousReadings: mergePreviousReadings(current.page.previousReadings, waterLog.readings),
          waterLogs: [waterLog, ...current.page.waterLogs],
        },
      }
    }

    // 成功不跳頁、不彈 toast：輸入區與歷史區在同一頁，最好的證據就是它出現在下面。
    // 輸入欄清空，日期時間欄回到「現在」。
    for (const parameter of WATER_PARAMETER_ORDER) {
      readings[parameter] = ''
    }

    resetMeasuredAt()
  }
  catch (cause) {
    // 失敗時什麼都不清：剛才輸入的值全部還在，修正後可以直接重送（驗收條件）
    error.value = apiErrorMessage(cause, GENERIC_ERROR)
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="mx-auto max-w-2xl pb-10">
    <!-- 頁首：← 返回 · 記錄水質 · <缸名> · <尺寸> -->
    <header
      class="sticky top-0 z-10 flex items-start gap-2 bg-default px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3"
    >
      <!--
        返回「上一頁」而不是寫死回首頁：從趨勢頁點進來的話，回首頁是錯的。
        因此是 button 不是 NuxtLink——沒有一個固定的目的地可以寫進 href。
      -->
      <button
        data-testid="water-log-back"
        type="button"
        aria-label="返回上一頁"
        class="-ml-1 shrink-0 p-1 text-highlighted"
        @click="router.back()"
      >
        <UIcon
          name="i-lucide-chevron-left"
          class="size-6"
        />
      </button>

      <div class="min-w-0 flex-1">
        <h1 class="truncate text-2xl font-bold">
          記錄水質
        </h1>

        <p
          data-testid="water-log-subtitle"
          class="mt-0.5 truncate text-sm text-muted"
        >
          {{ subtitle }}
        </p>
      </div>
    </header>

    <!--
      拿不到資料。要排在骨架與空狀態之前：三者的 tank 都是 null，先問的那一個說了算。
      上方的返回入口在三態下都留著，人走得回去。
    -->
    <LoadErrorState
      v-if="loadFailed"
      :retrying="retrying"
      @retry="retryLoad"
    />

    <!--
      資料還在路上時的骨架。#84 之後是 SPA，首屏沒有伺服器算好的畫面，
      直接判斷「清單是不是空的」會先閃一次「還沒有任何記錄」。
    -->
    <div
      v-else-if="loading"
      data-testid="water-log-loading"
      class="space-y-2.5 px-4 pt-2"
    >
      <div
        v-for="placeholder in 7"
        :key="placeholder"
        class="h-16 animate-pulse rounded-2xl bg-elevated/60"
      />
      <span class="sr-only">載入中</span>
    </div>

    <!-- 水質是記在缸底下的，沒有缸就沒有東西可記 -->
    <div
      v-else-if="!tank"
      data-testid="tank-empty"
      class="px-4 py-12 text-center"
    >
      <p class="text-2xl font-semibold">
        還沒有任何缸
      </p>

      <p class="mx-auto mt-3 max-w-xs text-balance text-muted">
        水質是記在缸底下的，先建立一個缸才記得起來。
      </p>

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
    </div>

    <template v-else>
      <!--
        送出走的是按鈕的 @click（type="button"），form 只負責把欄位圈在一起：
        submit 事件同樣導到 submit()，但不靠瀏覽器把點擊轉成送出。
      -->
      <form
        data-testid="water-log-form"
        novalidate
        @submit.prevent="submit"
      >
        <!-- 日期與時間同一列兩欄，各佔一半寬。用原生的 date / time 輸入，手機上體驗與無障礙都比較好 -->
        <div class="grid grid-cols-2 gap-3 px-4">
          <label class="flex items-center gap-2 rounded-2xl bg-elevated/60 px-4 py-3">
            <span class="shrink-0 text-sm text-dimmed">日期</span>

            <input
              v-model="measuredDate"
              name="measuredDate"
              type="date"
              class="min-w-0 flex-1 bg-transparent text-right text-lg font-semibold tabular-nums outline-none"
            >
          </label>

          <label class="flex items-center gap-2 rounded-2xl bg-elevated/60 px-4 py-3">
            <span class="shrink-0 text-sm text-dimmed">時間</span>

            <input
              v-model="measuredTime"
              name="measuredTime"
              type="time"
              class="min-w-0 flex-1 bg-transparent text-right text-lg font-semibold tabular-nums outline-none"
            >
          </label>
        </div>

        <p class="mt-6 px-4 text-xs tracking-[0.3em] text-dimmed">
          元素讀值
        </p>

        <!--
          一列一項：左邊標籤、中間輸入、右邊單位與「上次」。
          兩欄式在 390px 下會把「上次 8.0」擠掉。
        -->
        <div class="mt-2.5 flex flex-col gap-2.5 px-4">
          <div
            v-for="field in fields"
            :key="field.parameter"
            data-testid="reading-field"
            :data-parameter="field.parameter"
            class="rounded-2xl border bg-elevated/40 px-4 py-3 transition-colors"
            :class="fieldErrors[field.parameter]
              ? 'border-error'
              : 'border-transparent focus-within:border-primary'"
          >
            <div class="flex items-center gap-3">
              <label
                :for="`reading-${field.parameter}`"
                data-testid="reading-label"
                class="w-14 shrink-0 text-sm tracking-widest text-muted"
              >{{ field.label }}</label>

              <!--
                inputmode="decimal" 而不是 type="number"：上下箭頭與滾輪會誤觸，
                各家瀏覽器對非法輸入的處理也不一致（清成空字串的話，使用者打錯了卻看不出來）。
              -->
              <input
                :id="`reading-${field.parameter}`"
                v-model="readings[field.parameter]"
                :name="field.parameter"
                type="text"
                inputmode="decimal"
                autocomplete="off"
                :placeholder="MISSING_READING_TEXT"
                :aria-invalid="fieldErrors[field.parameter] ? 'true' : undefined"
                class="min-w-0 flex-1 bg-transparent text-2xl font-bold tabular-nums outline-none placeholder:font-normal placeholder:text-dimmed"
                @blur="validateField(field.parameter)"
              >

              <span
                data-testid="reading-unit"
                class="shrink-0 text-sm text-dimmed"
              >{{ field.unit }}</span>

              <!--
                從未量測過的測項不顯示「上次」，只留單位——用「上次 —」佔位的話，
                「還沒量過」與「量過但這次沒填」會長得一模一樣。
              -->
              <span
                v-if="field.previousDisplay"
                data-testid="reading-previous"
                class="shrink-0 text-sm text-dimmed"
              >上次 {{ field.previousDisplay }}</span>
            </div>

            <p
              v-if="fieldErrors[field.parameter]"
              data-testid="reading-error"
              role="alert"
              class="mt-1.5 text-xs text-error"
            >
              {{ fieldErrors[field.parameter] }}
            </p>
          </div>
        </div>

        <div class="mt-5 px-4">
          <UButton
            data-testid="water-log-submit"
            type="button"
            color="primary"
            size="xl"
            block
            :disabled="submitting"
            :loading="submitting"
            class="rounded-2xl py-4 text-base font-semibold"
            @click="submit"
          >
            儲存這筆記錄
          </UButton>

          <!-- 錯誤顯示在儲存按鈕附近，輸入值全部保留 -->
          <p
            v-if="error"
            data-testid="water-log-error"
            role="alert"
            class="mt-3 text-center text-sm text-error"
          >
            {{ error }}
          </p>
        </div>
      </form>

      <p class="mt-8 px-4 text-xs tracking-[0.3em] text-dimmed">
        歷史記錄
      </p>

      <ul
        v-if="rows.length"
        class="mt-1 px-4"
      >
        <li
          v-for="row in rows"
          :key="row.id"
          data-testid="history-row"
          :data-log-id="row.id"
          class="flex items-center justify-between gap-3 border-t border-default py-4 first:border-t-0"
        >
          <div class="min-w-0">
            <p
              data-testid="history-time"
              class="text-lg font-semibold tabular-nums"
            >
              {{ row.timeText }}
            </p>

            <p
              data-testid="history-summary"
              class="mt-0.5 truncate text-sm tabular-nums text-dimmed"
            >
              {{ row.summaryText }}
            </p>
          </div>

          <span
            data-testid="history-ago"
            class="shrink-0 text-sm text-dimmed"
          >
            {{ row.agoText }}
          </span>
        </li>
      </ul>

      <p
        v-else
        data-testid="history-empty"
        class="mt-4 px-4 text-center text-muted"
      >
        還沒有任何記錄，測完水就記一筆吧。
      </p>
    </template>
  </section>
</template>
