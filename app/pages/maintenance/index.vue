<script setup lang="ts">
import type { TankOption } from '#shared/types/home'
import type {
  MaintenanceCompletionRequest,
  MaintenancePageData,
  MaintenanceTaskDto,
  MaintenanceTaskResponse,
} from '#shared/types/maintenance'
import { buildMaintenanceSections, toLocalDateOnly } from '#shared/utils/maintenance'
import type { MaintenanceTodayRowView } from '#shared/utils/maintenanceView'
import { buildTodayRowViews, buildUpcomingRowViews, formatMaintenanceDate } from '#shared/utils/maintenanceView'
import { apiErrorMessage } from '#shared/utils/apiError'

// 保養提醒（Epic #1 screen-7，issue #125 ＝ #15 的畫面那一半）。
// 檔案放在 maintenance/index.vue，讓 /maintenance/tasks/* 不會被誤當成它的巢狀內容。
//
// 資料那一半是 #122 / PR #136：GET 回的是**事實**（啟用中的任務 + 每個任務最後一筆完成
// 紀錄），分區、徽章與 nextDueOn 全部由 #shared/utils/maintenance 的
// buildMaintenanceSections(tasks, now) 算——那些值都要問一件 server 答不出來的事：
// 使用者的「今天」是哪一天（server 跑 UTC、使用者在 UTC+8）。
//
useSeoMeta({
  title: '保養提醒 · ReefLog',
})

// 「今天是哪一天」整頁共用同一個時間點，各列才不會各自抓到差一秒的基準——
// 與 /log、/creatures 的作法一致
const now = new Date()
const today = toLocalDateOnly(now)

// $api 而不是裸 $fetch：session 過期時要被帶去登入頁，而不是停在一頁空資料上（#67）
const { $api } = useNuxtApp()

/**
 * 缸與保養任務串成同一個請求鏈，而不是兩個各自的 useAsyncData。
 *
 * 理由是驗收條件那條「不得先閃一次空狀態」：拆成兩個的話，缸拿到之後、任務還沒發出去
 * 之前會有一拍「已完成但沒有資料」，畫面就會閃一次「還沒有任何保養任務」。
 * 併成一個之後，status 只有 pending → success 兩種樣子。
 *
 * lazy：這一頁自己畫得出載入樣態，所以不在 setup 階段擋著整頁不渲染。
 */
const { data, status, refresh: reload } = useAsyncData('maintenance', async () => {
  const { tanks } = await $api<{ tanks: TankOption[] }>('/api/tanks')

  // 未指定時看的是清單第一個，也就是 schema 定義的「預設缸」（與 /log、/creatures 一致）
  const tank = tanks[0] ?? null

  return {
    tank,
    page: tank ? await $api<MaintenancePageData>(`/api/tanks/${tank.id}/maintenance`) : null,
  }
}, { lazy: true })

/**
 * issue #132 / #133：請求失敗時 data 是 null，與「成功但沒有任務」長得一模一樣。
 * 少了這一態，「拿不到資料」會被畫成「你還沒有任何保養任務」，而使用者會照著那句話
 * 去建立一個他其實早就有的任務。
 *
 * 401 不在此列：那條路由由 $api 的攔截器帶去登入頁（#67），比這裡更早。
 */
const { failed: loadFailed, retrying, retry: retryLoad } = useLoadFailure([status], reload)

/**
 * 訪客的示範資料還在複製中（issue #144）。
 *
 * 複製要 11.5 秒，而使用者在那段時間可以從底部的 tab 列走到這一頁。只有首頁認得
 * 這一態的話，這裡會畫成「還沒有任何缸」——而首頁同一時間正說著「正在為你準備」。
 *
 * 這一頁也負責觸發：書籤直接開這裡的訪客，首頁根本沒掛載，補建那支 API 一次都不會
 * 被呼叫，他會永遠等不到資料。
 */
const { preparing: sandboxPreparing, ensure } = useGuestSandbox()

const tanksEmpty = computed(() => !!data.value && !data.value.tank)

const preparing = computed(() => !loadFailed.value && tanksEmpty.value && sandboxPreparing.value)

watch(data, () => {
  if (tanksEmpty.value) {
    void ensure(reload)
  }
}, { immediate: true })

// 失敗（含重試進行中）不算載入中：骨架排在錯誤區塊之後的話，重試的那一段會把
// 錯誤區塊換成骨架，再次失敗時中間那一拍就成了「什麼都沒說」。
const loading = computed(() =>
  !loadFailed.value && (status.value === 'idle' || status.value === 'pending'),
)

const tank = computed(() => data.value?.tank ?? null)
const tasks = computed(() => data.value?.page?.tasks ?? [])

const subtitle = computed(() =>
  tank.value ? `${tank.value.name} · ${formatMaintenanceDate(now)}` : '',
)

// 分區與徽章一律重跑同一支純函式：勾選成功後把新的任務換進本地清單，
// 這裡就自動正確，不必整頁重抓（與 /log 把新記錄 unshift 進歷史同一個作法）
const sections = computed(() => buildMaintenanceSections(tasks.value, now))
const todayRows = computed(() => buildTodayRowViews(sections.value.today))
const upcomingRows = computed(() => buildUpcomingRowViews(sections.value.upcoming))
const laterRows = computed(() => buildUpcomingRowViews(sections.value.later))

// 只有 API 真的沒有任何啟用任務時才是空狀態。到期日在 30 天窗口以後的任務仍存在，
// 也必須保留 #17 的編輯入口。
const isEmpty = computed(() => tasks.value.length === 0)

/** 正在送出的任務。連點兩下的第一道防線（第二道是資料庫的 @@unique([taskId, completedOn])） */
const pending = reactive(new Set<string>())

/**
 * 每一列自己的錯誤訊息，空字串代表這一列沒問題（與 /log 的 fieldErrors 同一個作法）。
 *
 * 刻意不用整頁的錯誤區塊——那會把「一列沒勾成功」講成「整頁壞了」。
 */
const rowErrors = reactive<Record<string, string>>({})

const TOGGLE_ERROR = '沒有存到，請稍後再試。'

/**
 * useAsyncData 的 data 預設是 shallowRef，只動裡面一層的話畫面不會跟著更新，
 * 所以整包換掉（與 /log 相同）。
 */
function writeTasks(next: MaintenanceTaskDto[]) {
  const current = data.value

  if (current?.page) {
    data.value = { tank: current.tank, page: { tasks: next } }
  }
}

/**
 * 樂觀更新後的那一個任務。
 *
 * 勾選：completedOn 就是我們要送出去的那一天、completedAt 是按下去的這一刻——
 * 與 server 之後會寫進去的值一致，所以回應到達時畫面不會再跳一次。
 *
 * 取消：本地不知道「上一次」是哪一天（那要整份履歷，GET 只回最後一筆），所以誠實地
 * 給 null。副作用是 nextDueOn 暫時退回 startOn / createdOn 起算，極端情況下
 * （剛建立、週期很長、今天剛做完）那一列會短暫跳到「即將到期」——server 的回應
 * 帶著真正的最後一筆，下一拍就正確了。處理中的那一列不顯示右側狀態，
 * 就是為了不讓這個暫時值以「逾期 89 天」的樣子閃出來。
 */
function optimistic(task: MaintenanceTaskDto, completing: boolean): MaintenanceTaskDto {
  return {
    ...task,
    lastCompletion: completing ? { completedAt: new Date().toISOString(), completedOn: today } : null,
  }
}

/**
 * 勾選 / 取消今天的保養。
 *
 * 先改樣式再送請求：勾一個 checkbox 卻要等網路來回才有反應，在手機上感覺就像沒按到。
 * 失敗則回捲到「點擊前」那一份清單，而不是重抓一次——重抓會把使用者在這段時間內
 * 勾好的其他列一起洗掉。
 */
async function toggle(row: MaintenanceTodayRowView) {
  // 連點兩下的第一道防線。checkbox 同時也是 disabled 的，這一句擋的是鍵盤與
  // 「disabled 生效前那一拍」送進來的第二次點擊
  if (pending.has(row.id)) {
    return
  }

  const snapshot = tasks.value
  const target = snapshot.find(task => task.id === row.id)

  if (!target) {
    return
  }

  const completing = !row.completedToday

  pending.add(row.id)
  rowErrors[row.id] = ''
  writeTasks(snapshot.map(task => task.id === row.id ? optimistic(task, completing) : task))

  try {
    // 兩支寫入都回「更新後的那一個任務」，換進本地清單再重跑一次
    // buildMaintenanceSections 就好，不必整頁重抓
    const { task } = completing
      ? await $api<MaintenanceTaskResponse>(`/api/maintenance-tasks/${row.id}/completions`, {
          method: 'POST',
          body: { completedOn: today } satisfies MaintenanceCompletionRequest,
        })
      : await $api<MaintenanceTaskResponse>(`/api/maintenance-tasks/${row.id}/completions/${today}`, {
          method: 'DELETE',
        })

    writeTasks(tasks.value.map(current => current.id === row.id ? task : current))
  }
  catch (cause) {
    // 回捲的目標是「點擊前」，不是「重抓一次」
    writeTasks(snapshot)
    rowErrors[row.id] = apiErrorMessage(cause, TOGGLE_ERROR)
  }
  finally {
    pending.delete(row.id)
  }
}
</script>

<template>
  <section class="mx-auto max-w-2xl pb-10">
    <!-- 頁首：保養提醒 · <缸名> · <當地的今天>。三態下都留著，人才知道自己在哪一頁 -->
    <header class="flex items-start justify-between gap-3 px-4 pt-[calc(1.5rem+env(safe-area-inset-top))]">
      <div class="min-w-0">
        <h1 class="truncate text-3xl font-bold">
          保養提醒
        </h1>

        <p
          data-testid="maintenance-subtitle"
          class="mt-1 truncate text-sm text-muted"
        >
          {{ subtitle }}
        </p>
      </div>

      <UButton
        v-if="tank"
        data-testid="maintenance-add"
        to="/maintenance/tasks/new"
        icon="i-lucide-plus"
        color="primary"
        variant="soft"
        size="lg"
        aria-label="新增保養任務"
        class="shrink-0 rounded-full"
      />
    </header>

    <!--
      拿不到資料。要排在骨架與空狀態之前：三者的任務清單都是空的，先問的那一個說了算。
      標題用 p——頁首的「保養提醒」是常駐的 h1，錯誤區塊再給一個就變成同一頁兩個 h1。
    -->
    <LoadErrorState
      v-if="loadFailed"
      :retrying="retrying"
      title-tag="p"
      @retry="retryLoad"
    />

    <!--
      資料還在路上時的骨架。#84 之後是 SPA，首屏沒有伺服器算好的畫面，
      直接判斷「清單是不是空的」會先閃一次「還沒有任何保養任務」。
    -->
    <div
      v-else-if="loading"
      data-testid="maintenance-loading"
      class="mt-6 space-y-2.5 px-4"
    >
      <div
        v-for="placeholder in 5"
        :key="placeholder"
        class="h-20 animate-pulse rounded-2xl bg-elevated/60"
      />
      <span class="sr-only">載入中</span>
    </div>

    <!--
      訪客的示範資料還在複製中（issue #144）。排在「沒有缸」之前：兩者在這一頁上
      長得一樣（都是空的），先問的那一個說了算，而此刻為真的是「還在路上」。
    -->
    <SandboxPreparingState
      v-else-if="preparing"
      title-tag="p"
    />

    <!-- 保養任務是記在缸底下的，沒有缸就沒有東西可提醒 -->
    <div
      v-else-if="!tank"
      data-testid="tank-empty"
      class="px-4 py-12 text-center"
    >
      <p class="text-2xl font-semibold">
        還沒有任何缸
      </p>

      <p class="mx-auto mt-3 max-w-xs text-balance text-muted">
        保養提醒是記在缸底下的，先建立一個缸才排得出保養。
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

    <!-- 兩區都空：一則空狀態，並直接提供新增第一個任務的入口。 -->
    <div
      v-else-if="isEmpty"
      data-testid="maintenance-empty"
      class="px-4 py-12 text-center"
    >
      <div
        class="mx-auto grid size-20 place-items-center rounded-full border border-dashed border-muted"
        aria-hidden="true"
      >
        <UIcon
          name="i-lucide-clipboard-list"
          class="size-8 text-dimmed"
        />
      </div>

      <p class="mt-6 text-2xl font-semibold">
        還沒有任何保養任務
      </p>

      <p class="mx-auto mt-3 max-w-xs text-balance text-muted">
        換水、洗棉、校正折射計這些週期性的工作，新增第一個任務之後就會在這裡提醒你。
      </p>

      <UButton
        data-testid="maintenance-empty-add"
        to="/maintenance/tasks/new"
        icon="i-lucide-plus"
        color="primary"
        size="xl"
        class="mt-8"
      >
        新增第一個任務
      </UButton>
    </div>

    <template v-else>
      <section
        data-testid="today-section"
        class="mt-6 px-4"
      >
        <div class="flex items-center gap-2">
          <h2 class="text-base font-semibold tracking-wide text-amber-400">
            今天該做
          </h2>

          <!-- 徽章只有這一區有：即將到期的數量不是「待辦」，給了數字反而像是在催 -->
          <span
            data-testid="today-badge"
            class="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-sm font-semibold tabular-nums text-amber-400"
            :aria-label="`未完成 ${sections.dueCount} 項`"
          >
            {{ sections.dueCount }}
          </span>
        </div>

        <ul
          v-if="todayRows.length"
          class="mt-3 flex flex-col gap-2.5"
        >
          <li
            v-for="row in todayRows"
            :key="row.id"
            data-testid="today-row"
            :data-task-id="row.id"
            :data-overdue="row.overdue ? 'true' : 'false'"
            class="rounded-2xl border transition-colors"
            :class="row.completedToday
              ? 'border-default bg-elevated/30 opacity-60'
              : row.overdue
                ? 'border-error/40 bg-error/5'
                : 'border-amber-500/30 bg-amber-500/5'"
          >
            <div class="flex items-center gap-3 p-3">
              <!--
                原生 checkbox 難以做出截圖上那個圓角方框與處理中的轉圈，
                所以用 button + role="checkbox"：鍵盤操作（Space / Enter）與
                aria-checked 都還在，畫面才有地方擺三種樣態。
              -->
              <button
                data-testid="task-checkbox"
                type="button"
                role="checkbox"
                :aria-checked="row.completedToday ? 'true' : 'false'"
                :aria-label="row.name"
                :disabled="pending.has(row.id)"
                class="grid size-10 shrink-0 place-items-center rounded-xl border-2 transition-colors"
                :class="row.completedToday
                  ? 'border-primary bg-primary text-inverted'
                  : 'border-muted'"
                @click="toggle(row)"
              >
                <UIcon
                  v-if="pending.has(row.id)"
                  name="i-lucide-loader-circle"
                  class="size-5 animate-spin text-dimmed"
                />
                <UIcon
                  v-else-if="row.completedToday"
                  name="i-lucide-check"
                  class="size-5"
                />
              </button>

              <div class="min-w-0 flex-1">
                <p
                  data-testid="task-name"
                  class="truncate text-lg font-semibold"
                  :class="row.completedToday ? 'text-muted' : ''"
                >
                  {{ row.name }}
                </p>

                <p
                  data-testid="task-subtitle"
                  class="mt-0.5 truncate text-sm tabular-nums text-muted"
                >
                  {{ row.subtitle }}
                </p>

                <!-- 錯誤講在那一列旁邊：一列沒勾成功，不等於整頁壞了 -->
                <p
                  v-if="rowErrors[row.id]"
                  data-testid="task-error"
                  role="alert"
                  class="mt-1 text-xs text-error"
                >
                  {{ rowErrors[row.id] }}
                </p>
              </div>

              <!--
                處理中不顯示右側狀態：取消勾選的樂觀值會讓到期日暫時退回起算日，
                那一拍的「逾期 89 天」只是還沒收到 server 的回應而已。
              -->
              <span
                v-if="row.statusText && !pending.has(row.id)"
                data-testid="task-status"
                class="flex shrink-0 items-center gap-1 text-sm font-semibold"
                :class="row.overdue ? 'rounded-full bg-error/15 px-2.5 py-1 text-error' : 'text-amber-400'"
              >
                <UIcon
                  v-if="row.overdue"
                  name="i-lucide-alert-triangle"
                  class="size-3.5"
                  aria-hidden="true"
                />
                {{ row.statusText }}
              </span>

              <UButton
                data-testid="maintenance-edit"
                :to="`/maintenance/tasks/${row.id}/edit`"
                icon="i-lucide-pencil"
                color="neutral"
                variant="ghost"
                :aria-label="`編輯 ${row.name}`"
                class="shrink-0 rounded-full"
              />
            </div>
          </li>
        </ul>

        <!--
          今天該做空、即將到期有東西是正常且常見的，這時整區消失反而像壞掉，
          所以留一句短句（issue #125 第 4-4 節）。
        -->
        <p
          v-else
          data-testid="today-empty"
          class="mt-3 rounded-2xl border border-dashed border-muted px-4 py-6 text-center text-sm text-muted"
        >
          今天沒有待辦，休息一下。
        </p>
      </section>

      <section
        data-testid="upcoming-section"
        class="mt-8 px-4"
      >
        <h2 class="text-base font-semibold tracking-wide text-muted">
          即將到期
        </h2>

        <!--
          這一區沒有 checkbox：提前打勾會讓 nextDueOn 整條往後推，
          而畫面上沒有任何地方能解釋那個跳動（issue #125 第 4-2 節）。
        -->
        <ul
          v-if="upcomingRows.length"
          class="mt-3 flex flex-col gap-2.5"
        >
          <li
            v-for="row in upcomingRows"
            :key="row.id"
            data-testid="upcoming-row"
            :data-task-id="row.id"
            class="flex items-center gap-3 rounded-2xl border border-default bg-elevated/40 p-3"
          >
            <span class="flex size-14 shrink-0 flex-col items-center justify-center rounded-xl border border-default">
              <span
                data-testid="due-day"
                class="text-lg font-bold leading-tight tabular-nums"
              >
                {{ row.dayText }}
              </span>
              <span
                data-testid="due-month"
                class="text-[10px] leading-tight text-dimmed"
              >
                {{ row.monthText }}
              </span>
            </span>

            <div class="min-w-0 flex-1">
              <p
                data-testid="task-name"
                class="truncate text-lg font-semibold"
              >
                {{ row.name }}
              </p>

              <p
                data-testid="task-subtitle"
                class="mt-0.5 truncate text-sm text-muted"
              >
                {{ row.subtitle }}
              </p>
            </div>

            <span
              data-testid="due-in"
              class="shrink-0 text-sm tabular-nums text-dimmed"
            >
              {{ row.dueText }}
            </span>

            <UButton
              data-testid="maintenance-edit"
              :to="`/maintenance/tasks/${row.id}/edit`"
              icon="i-lucide-pencil"
              color="neutral"
              variant="ghost"
              :aria-label="`編輯 ${row.name}`"
              class="shrink-0 rounded-full"
            />
          </li>
        </ul>

        <p
          v-else
          data-testid="upcoming-empty"
          class="mt-3 rounded-2xl border border-dashed border-muted px-4 py-6 text-center text-sm text-muted"
        >
          接下來 30 天內沒有其他到期的保養。
        </p>
      </section>

      <section
        v-if="laterRows.length"
        data-testid="later-section"
        class="mt-8 px-4"
      >
        <h2 class="text-base font-semibold tracking-wide text-muted">
          其他任務
        </h2>

        <ul class="mt-3 flex flex-col gap-2.5">
          <li
            v-for="row in laterRows"
            :key="row.id"
            data-testid="later-row"
            :data-task-id="row.id"
            class="flex items-center gap-3 rounded-2xl border border-default bg-elevated/40 p-3"
          >
            <span class="flex size-14 shrink-0 flex-col items-center justify-center rounded-xl border border-default">
              <span
                data-testid="due-day"
                class="text-lg font-bold leading-tight tabular-nums"
              >
                {{ row.dayText }}
              </span>
              <span
                data-testid="due-month"
                class="text-[10px] leading-tight text-dimmed"
              >
                {{ row.monthText }}
              </span>
            </span>

            <div class="min-w-0 flex-1">
              <p
                data-testid="task-name"
                class="truncate text-lg font-semibold"
              >
                {{ row.name }}
              </p>

              <p
                data-testid="task-subtitle"
                class="mt-0.5 truncate text-sm text-muted"
              >
                {{ row.subtitle }}
              </p>
            </div>

            <span
              data-testid="due-in"
              class="shrink-0 text-sm tabular-nums text-dimmed"
            >
              {{ row.dueText }}
            </span>

            <UButton
              data-testid="maintenance-edit"
              :to="`/maintenance/tasks/${row.id}/edit`"
              icon="i-lucide-pencil"
              color="neutral"
              variant="ghost"
              :aria-label="`編輯 ${row.name}`"
              class="shrink-0 rounded-full"
            />
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>
