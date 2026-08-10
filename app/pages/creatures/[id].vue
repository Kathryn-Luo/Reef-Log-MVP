<script setup lang="ts">
import type { CreatureCategoryKey, CreatureStatusKey, TankOption } from '#shared/types/home'
import type {
  CreatureDetailDto,
  CreatureDetailResponse,
  DeathCauseKey,
  MoveCreatureResponse,
} from '#shared/types/creature'
import {
  CREATURE_STATUS_OPTIONS,
  DEATH_CAUSE_OPTIONS,
  daysInTank,
  formatFullDate,
  formatTaxonomy,
  parseCreatureStatusInput,
} from '#shared/utils/creatureDetail'
import type { MoveFailureView } from '#shared/utils/creatureMove'
import { describeMoveFailure, formatTankSpec, tankDotColor } from '#shared/utils/creatureMove'
import { apiErrorMessage, apiErrorStatus } from '#shared/utils/apiError'

// 生物詳情 · 死亡記錄（Epic #1 screen-6，issue #14）。
//
// 這一頁只編輯「狀態 + 死亡 / 生病記錄」。俗名 / 學名 / 照片 / 入缸日的編輯在
// 頁首右上角的「編輯」後面，那個表單 Epic 中沒有截圖，由另一支 needs-design 的
// 「新增 / 編輯生物表單」issue 負責；這裡只渲染按鈕並連向該路由。

const route = useRoute()
const creatureId = computed(() => String(route.params.id))

useSeoMeta({
  title: '生物詳情 · ReefLog',
})

// 「在缸天數」是相對現在的推算值。整頁共用同一個時間點，
// 免得畫面上兩處各自抓到差一秒的基準。
const now = new Date()

// $api 而不是裸 $fetch：session 過期時要被帶去登入頁，而不是停在一頁空資料上（#67）。
// 下面那個 .catch 不會把 401 一起吞掉——導向發生在 $api 自己的攔截器裡，比這裡早。
const { $api } = useNuxtApp()

const {
  data,
  status: loadStatus,
  refresh: reload,
} = await useAsyncData<CreatureDetailResponse | null>(
  () => `creature:${creatureId.value}`,
  () =>
    $api<CreatureDetailResponse>(`/api/creatures/${creatureId.value}`).catch((cause) => {
      // 找不到（或不屬於自己）時不炸掉整頁：這一頁自己畫得出「找不到這隻生物」，
      // 而且底部的 tab 列要留著，人才走得回去。
      if (apiErrorStatus(cause) === 404) {
        return null
      }

      // 其餘的（500 / 離線 / function 掛掉）要讓 useAsyncData 進入 error 狀態。
      // 原本這裡是 `.catch(() => null)` 一律吞掉，於是「拿不到資料」被講成
      // 「找不到這隻生物」——兩件完全不同的事講成同一句（issue #132）。
      throw cause
    }),
  { watch: [creatureId] },
)

const {
  failed: loadFailed,
  retrying,
  retry: retryLoad,
} = useLoadFailure([loadStatus], reload)

const creature = computed<CreatureDetailDto | null>(() => data.value?.creature ?? null)

// ── 所在缸與目標缸清單（issue #120）─────────────────────────────
//
// GET /api/tanks 只回目前使用者名下未封存的缸；把生物目前所在的那一個濾掉，
// 剩下的就是「移動到其他缸」可以選的目標。
//
// 這一支的失敗不進 useLoadFailure：拿不到缸清單只代表「這一頁移不了生物」，
// 詳情本身仍然完整。整頁翻成「載入失敗」會讓人連狀態都改不了。
const {
  data: tankList,
  refresh: refreshTanks,
} = await useAsyncData('creature-detail:tanks', () => $api<{ tanks: TankOption[] }>('/api/tanks'))

const tanks = computed<TankOption[]>(() => tankList.value?.tanks ?? [])

/** 目前所在的那一個缸。缸清單拿不到時為 null，缸名仍由詳情自己帶著 */
const currentTank = computed(() => tanks.value.find(tank => tank.id === creature.value?.tankId) ?? null)

/** 所在缸那一列左側的代表色點。缸清單還沒回來時退回主色（見 tankDotColor） */
const currentTankColor = computed(() => tankDotColor(currentTank.value ?? { colorHex: null }))

const otherTanks = computed(() => tanks.value.filter(tank => tank.id !== creature.value?.tankId))

/**
 * 名下沒有其他未封存的缸時，「所在缸」整塊連同入口都不出現——不是變成 disabled。
 * 一顆按下去只能說「沒有缸」的按鈕，不如不要有。
 */
const canMove = computed(() => otherTanks.value.length > 0)

const moveOpen = ref(false)
const selectedTankId = ref<string | null>(null)
const moving = ref(false)
const moveFailure = ref<MoveFailureView | null>(null)

/** 404 的目標缸：它已經不在了，留在清單裡只會被再點一次（issue #120 的 3d） */
const droppedTankIds = ref<string[]>([])

const moveTargets = computed(() =>
  otherTanks.value.filter(tank => !droppedTankIds.value.includes(tank.id)),
)

function resetMove() {
  selectedTankId.value = null
  moveFailure.value = null
  droppedTankIds.value = []
}

async function openMove() {
  resetMove()
  moveOpen.value = true

  // 缸清單重新取一次：這一頁可能已經開了很久，中間新增或封存的缸都要算數
  await refreshTanks()
}

function closeMove() {
  moveOpen.value = false
  resetMove()
}

function selectTank(tankId: string) {
  selectedTankId.value = tankId
}

/** 「選其他缸」：把錯誤卡片收起來，回到選擇狀態 */
function dismissMoveError() {
  moveFailure.value = null
}

async function move() {
  const source = creature.value
  const target = moveTargets.value.find(tank => tank.id === selectedTankId.value)

  // 還沒選目標就沒有東西可送（第二步才是送出），送出中也不再送第二次——
  // 畫面上那顆鈕此刻本來就按不下去，這一條是同一件事在資料流這一側的保險。
  if (!source || !target || moving.value) {
    return
  }

  moving.value = true
  moveFailure.value = null

  try {
    await $api<MoveCreatureResponse>(`/api/creatures/${source.id}/move`, {
      method: 'PATCH',
      body: { tankId: target.id },
    })

    // 換缸不該動到「狀態」區還沒儲存的編輯。
    //
    // 底下的 reload() 會換掉 creature，而讓表單跟著伺服器對齊的那個 watch
    // （見 reset 上方的註解）會無條件把舊值蓋回來——改到一半的狀態、日期與備註
    // 就這樣沒了，連 dirty 都跟著變 false，儲存鈕一起消失，畫面上不會留下
    // 任何「你剛剛改過東西」的痕跡。
    //
    // 修法放在這裡而不是給那個 watch 加 `!dirty` 的守衛：「改回存活」儲存時，
    // 使用者填過的死亡日仍留在 form 裡而伺服器回的是 null，那一刻 dirty 正是 true，
    // 加了守衛就會跳過 reset，被清掉的死亡欄位不會從畫面上消失——那正是那個 watch
    // 存在的理由。所以只在換缸這條路上接住再放回去。
    const pending = dirty.value ? { ...form } : null

    // 不做樂觀更新：重新取一次詳情，「所在缸」一律由伺服器的答案決定。
    // 成功之後才收起 sheet——資料還沒對齊就關掉的話，畫面會閃過一次舊的缸名。
    await reload()

    if (pending) {
      // 等那個 watch 先跑完（flush: 'pre'）再放回去，否則會被它蓋掉
      await nextTick()
      Object.assign(form, pending)
    }

    moveOpen.value = false
    resetMove()
  }
  catch (cause) {
    const failure = describeMoveFailure(apiErrorStatus(cause), {
      creatureName: source.name,
      // 失敗時生物仍在原本的缸，訊息裡指的就是這一個
      currentTankName: source.tankName,
      targetTankName: target.name,
    })

    moveFailure.value = failure

    if (failure.dropTarget) {
      droppedTankIds.value = [...droppedTankIds.value, target.id]
    }

    // 「這個目標不行」時把選取一併清掉：接下來唯一走得下去的動作是換一個目標。
    // 可以重送的那一種（離線、5xx）則留著選取，「重試」才有東西可以重送。
    if (failure.action === 'choose-other') {
      selectedTankId.value = null
    }
  }
  finally {
    moving.value = false
  }
}

// 沒有照片時的預設圖示（screen-6 的照片區是一格斜線佔位）。
// 依分類換圖示，看一眼就知道這是魚還是珊瑚。
const PLACEHOLDER_ICONS: Record<CreatureCategoryKey, string> = {
  FISH: 'i-lucide-fish',
  CORAL: 'i-lucide-flower-2',
  OTHER: 'i-lucide-shell',
}

// 沒有照片的縮圖：設計稿的斜線佔位（與庫存列表同一組漸層）
const PHOTO_PLACEHOLDER = 'repeating-linear-gradient(135deg, rgba(148,163,184,0.16) 0 6px, transparent 6px 12px)'

// 選中的狀態用該狀態自己的顏色：「生病」是橘、「死亡」是灰、「存活」是主色，
// 與首頁卡片、庫存列表上的狀態點同一組語彙。
const STATUS_SELECTED_CLASSES: Record<CreatureStatusKey, string> = {
  ALIVE: 'border-primary bg-primary/15 font-semibold text-primary',
  SICK: 'border-amber-500 bg-amber-500/15 font-semibold text-amber-400',
  DEAD: 'border-neutral-400 bg-elevated font-semibold text-highlighted',
}

// 未選中的「生病」仍帶著橘色輪廓（截圖如此），其餘兩個是安靜的灰
const STATUS_IDLE_CLASSES: Record<CreatureStatusKey, string> = {
  ALIVE: 'border-default text-muted',
  SICK: 'border-amber-500/40 text-amber-400',
  DEAD: 'border-default text-muted',
}

const form = reactive({
  status: 'ALIVE' as CreatureStatusKey,
  observedSickOn: '',
  ailment: '',
  diedOn: '',
  causeOfDeath: null as DeathCauseKey | null,
  deathNote: '',
})

const error = ref<string | null>(null)
const saving = ref(false)

/**
 * 表單狀態一律以字串持有（null → 空字串），送出前才交給 parseCreatureStatusInput
 * 正規化。日期輸入框吃的就是字串，把 null 塞進去只會得到 React 式的警告。
 */
function reset(source: CreatureDetailDto) {
  form.status = source.status
  form.observedSickOn = source.observedSickOn ?? ''
  form.ailment = source.ailment ?? ''
  form.diedOn = source.diedOn ?? ''
  form.causeOfDeath = source.causeOfDeath
  form.deathNote = source.deathNote ?? ''

  error.value = null
}

// 儲存成功後 data 會換成後端回來的那一份，這個 watch 讓表單跟著對齊：
// 「改回存活」時被清掉的死亡欄位，畫面上也要一起消失。
watch(creature, (value) => {
  if (value) {
    reset(value)
  }
}, { immediate: true })

/**
 * 沒有改動就沒有東西可存，「儲存」整顆不出現（PR #58 review）。
 * 只是 disabled 的話，一顆按不下去的按鈕會讓人以為畫面壞了；
 * 讓它在「狀態」區任一值被改動後才長出來，按鈕出現本身就是「有東西待存」的提示。
 *
 * 「任一值」包含狀態三選一與底下記錄區塊的欄位——那些欄位是狀態的一部分，
 * 只改備註不改狀態同樣要存得起來。
 */
const dirty = computed(() => {
  const source = creature.value

  if (!source) {
    return false
  }

  return form.status !== source.status
    || form.observedSickOn !== (source.observedSickOn ?? '')
    || form.ailment !== (source.ailment ?? '')
    || form.diedOn !== (source.diedOn ?? '')
    || form.causeOfDeath !== source.causeOfDeath
    || form.deathNote !== (source.deathNote ?? '')
})

const taxonomy = computed(() =>
  creature.value ? formatTaxonomy(creature.value.category, creature.value.subCategory) : '',
)

// 入缸日與在缸天數看的是「已經存下去的資料」而不是表單：還沒儲存的死亡日
// 不該讓天數先跳掉。存檔後 data 換新，這兩個值跟著重算。
const addedOn = computed(() => creature.value ? formatFullDate(creature.value.addedOn) : '')
const days = computed(() => creature.value ? daysInTank(creature.value, now) : 0)

const GENERIC_ERROR = '儲存失敗，請稍後再試。'

async function save() {
  const source = creature.value

  if (!source) {
    return
  }

  // 入缸日不由表單提供：日期先後比的是這一隻實際的入缸日
  const parsed = parseCreatureStatusInput(form, { addedOn: source.addedOn })

  if (!parsed.ok) {
    error.value = parsed.message
    return
  }

  error.value = null
  saving.value = true

  try {
    data.value = await $api<CreatureDetailResponse>(`/api/creatures/${source.id}`, {
      method: 'PATCH',
      body: parsed.value,
    })
  }
  catch (cause) {
    error.value = apiErrorMessage(cause, GENERIC_ERROR)
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="mx-auto max-w-2xl pb-10">
    <!-- 頁首：← 返回 · 生物詳情 · 編輯（設計稿的頂部橫列） -->
    <header
      class="sticky top-0 z-10 flex items-center gap-2 bg-default px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3"
    >
      <NuxtLink
        data-testid="creature-back"
        to="/creatures"
        aria-label="返回生物列表"
        class="-ml-1 shrink-0 p-1 text-highlighted"
      >
        <UIcon
          name="i-lucide-chevron-left"
          class="size-6"
        />
      </NuxtLink>

      <p class="min-w-0 flex-1 truncate text-xl font-bold">
        生物詳情
      </p>

      <NuxtLink
        data-testid="creature-edit"
        :to="`/creatures/${creatureId}/edit`"
        class="shrink-0 text-base font-medium text-primary"
      >
        編輯
      </NuxtLink>
    </header>

    <!--
      拿不到資料。要排在「找不到」之前：兩者的 creature 都是 null，
      先問的那一個說了算。上方的返回入口在兩態下都留著，人走得回去。
    -->
    <LoadErrorState
      v-if="loadFailed"
      :retrying="retrying"
      @retry="retryLoad"
    />

    <p
      v-else-if="!creature"
      data-testid="creature-missing"
      class="mt-10 px-4 text-center text-muted"
    >
      找不到這隻生物，牠可能已經被刪除，或不在你的缸裡。
    </p>

    <template v-else>
      <!-- 照片 · 俗名 · 學名 · 「魚 · 神仙」 -->
      <div class="flex items-start gap-4 px-4 pt-2">
        <span
          data-testid="creature-photo"
          class="flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-elevated"
          :style="creature.photoUrl ? undefined : { backgroundImage: PHOTO_PLACEHOLDER }"
        >
          <img
            v-if="creature.photoUrl"
            :src="creature.photoUrl"
            :alt="creature.name"
            class="size-full object-cover"
          >
          <UIcon
            v-else
            data-testid="creature-photo-placeholder"
            :name="PLACEHOLDER_ICONS[creature.category]"
            class="size-10 text-dimmed"
          />
        </span>

        <div class="min-w-0 flex-1 pt-1">
          <h1
            data-testid="creature-name"
            class="truncate text-3xl font-bold"
          >
            {{ creature.name }}
          </h1>

          <p
            v-if="creature.scientificName"
            data-testid="creature-scientific-name"
            class="mt-1 truncate font-mono text-base text-dimmed"
          >
            {{ creature.scientificName }}
          </p>

          <span
            data-testid="creature-taxonomy"
            class="mt-3 inline-block rounded-lg border border-default px-3 py-1.5 text-sm text-muted"
          >
            {{ taxonomy }}
          </span>
        </div>
      </div>

      <!-- 狀態：三個互斥選項 -->
      <div class="mt-7 px-4">
        <p
          id="creature-status-label"
          class="text-sm tracking-widest text-dimmed"
        >
          狀態
        </p>

        <div
          role="group"
          aria-labelledby="creature-status-label"
          class="mt-2.5 grid grid-cols-3 gap-3"
        >
          <button
            v-for="option in CREATURE_STATUS_OPTIONS"
            :key="option.key"
            data-testid="status-option"
            type="button"
            :data-status="option.key"
            :aria-pressed="form.status === option.key ? 'true' : 'false'"
            class="rounded-xl border py-4 text-lg transition-colors"
            :class="form.status === option.key
              ? STATUS_SELECTED_CLASSES[option.key]
              : STATUS_IDLE_CLASSES[option.key]"
            @click="form.status = option.key"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <!--
        死亡記錄：發病日 + 死亡日 + 死因 + 備註。
        observedSickOn 是生病與死亡共用的同一個欄位（schema.prisma 的註解），
        所以這裡的「發病日」與生病區塊的是同一格資料。
      -->
      <div
        v-if="form.status === 'DEAD'"
        data-testid="death-record"
        class="mx-4 mt-5 rounded-2xl border border-default p-4"
      >
        <p class="flex items-center gap-2 text-base font-semibold">
          <span
            class="size-2 rounded-full bg-neutral-500"
            aria-hidden="true"
          />
          死亡記錄
        </p>

        <div class="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label
              for="creature-observed-sick-on"
              class="block text-sm text-dimmed"
            >發病日</label>

            <UInput
              id="creature-observed-sick-on"
              v-model="form.observedSickOn"
              name="observedSickOn"
              type="date"
              class="mt-2 w-full"
            />
          </div>

          <div>
            <label
              for="creature-died-on"
              class="block text-sm text-dimmed"
            >死亡日</label>

            <UInput
              id="creature-died-on"
              v-model="form.diedOn"
              name="diedOn"
              type="date"
              class="mt-2 w-full"
            />
          </div>
        </div>

        <fieldset class="mt-5">
          <legend class="text-sm text-dimmed">
            死因
          </legend>

          <div class="mt-2.5 flex flex-wrap gap-2.5">
            <button
              v-for="cause in DEATH_CAUSE_OPTIONS"
              :key="cause.key"
              data-testid="death-cause-option"
              type="button"
              :data-cause="cause.key"
              :aria-pressed="form.causeOfDeath === cause.key ? 'true' : 'false'"
              class="rounded-full border px-4 py-2.5 text-sm transition-colors"
              :class="form.causeOfDeath === cause.key
                ? 'border-primary bg-primary font-semibold text-inverted'
                : 'border-default text-muted'"
              @click="form.causeOfDeath = cause.key"
            >
              {{ cause.label }}
            </button>
          </div>
        </fieldset>

        <div class="mt-5">
          <label
            for="creature-death-note"
            class="block text-sm text-dimmed"
          >備註</label>

          <UTextarea
            id="creature-death-note"
            v-model="form.deathNote"
            name="deathNote"
            :rows="3"
            placeholder="半夜跳出主缸，早上發現已乾。之後加裝上蓋防跳網。"
            class="mt-2 w-full"
          />
        </div>
      </div>

      <!-- 生病：只要發病日與症狀，不要求死亡日與死因 -->
      <div
        v-else-if="form.status === 'SICK'"
        data-testid="sick-record"
        class="mx-4 mt-5 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4"
      >
        <p class="flex items-center gap-2 text-base font-semibold text-amber-400">
          <span
            class="size-2 rounded-full bg-amber-400"
            aria-hidden="true"
          />
          生病記錄
        </p>

        <div class="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label
              for="creature-observed-sick-on"
              class="block text-sm text-dimmed"
            >發病日</label>

            <UInput
              id="creature-observed-sick-on"
              v-model="form.observedSickOn"
              name="observedSickOn"
              type="date"
              class="mt-2 w-full"
            />
          </div>

          <div>
            <label
              for="creature-ailment"
              class="block text-sm text-dimmed"
            >症狀</label>

            <UInput
              id="creature-ailment"
              v-model="form.ailment"
              name="ailment"
              placeholder="白點"
              autocomplete="off"
              class="mt-2 w-full"
            />
          </div>
        </div>

        <p class="mt-3 text-xs text-dimmed">
          發病日決定列表上的「觀察第 N 天」。
        </p>
      </div>

      <!-- 改了才出現。儲存失敗時 error 還在、改動也還在，這一區要留著讓人再按一次 -->
      <div
        v-if="dirty || error"
        class="mt-5 px-4"
      >
        <p
          v-if="error"
          data-testid="creature-error"
          role="alert"
          class="mb-3 text-sm text-error"
        >
          {{ error }}
        </p>

        <UButton
          data-testid="creature-save"
          type="button"
          color="primary"
          size="lg"
          block
          :loading="saving"
          class="rounded-xl py-3"
          @click="save"
        >
          儲存
        </UButton>
      </div>

      <!--
        所在缸與「移動到其他缸」（issue #120）。

        落在「狀態」與「入缸日」之間：先讓人看到現在在哪，再提供移動。不放頁首
        （被「編輯」佔住）也不放底部（保留給「儲存」），語意連貫且不與兩顆主鈕打架。

        名下沒有其他未封存的缸時整塊不出現——連「所在缸」的資訊一起收掉。
      -->
      <div
        v-if="canMove"
        data-testid="creature-tank-section"
        class="mt-7 px-4"
      >
        <p class="text-sm tracking-widest text-dimmed">
          所在缸
        </p>

        <div class="mt-2.5 rounded-2xl border border-default">
          <div
            data-testid="creature-current-tank"
            class="flex items-center gap-3 border-b border-default px-4 py-4"
          >
            <span
              class="size-5 shrink-0 rounded-[7px]"
              :style="{ backgroundColor: currentTankColor }"
              aria-hidden="true"
            />

            <span class="truncate text-lg font-bold">{{ creature.tankName }}</span>

            <span
              v-if="currentTank"
              class="truncate font-mono text-sm text-dimmed"
            >
              {{ formatTankSpec(currentTank) }}
            </span>
          </div>

          <button
            data-testid="creature-move-open"
            type="button"
            class="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-elevated/40"
            @click="openMove"
          >
            <UIcon
              name="i-lucide-log-out"
              class="size-5 shrink-0 text-primary"
              aria-hidden="true"
            />

            <span class="min-w-0 flex-1 truncate text-lg font-semibold text-primary">
              移動到其他缸
            </span>

            <UIcon
              name="i-lucide-chevron-right"
              class="size-5 shrink-0 text-dimmed"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      <CreatureMoveSheet
        :open="moveOpen"
        :creature-name="creature.name"
        :current-tank-name="creature.tankName"
        :tanks="moveTargets"
        :selected-tank-id="selectedTankId"
        :moving="moving"
        :failure="moveFailure"
        @close="closeMove"
        @select="selectTank"
        @confirm="move"
        @dismiss-error="dismissMoveError"
      />

      <!-- 入缸日與在缸天數：兩者都是推算值，schema 不存（見 schema.prisma 檔頭） -->
      <dl class="mt-8 px-4">
        <div class="flex items-center justify-between border-t border-default py-4">
          <dt class="text-muted">
            入缸日
          </dt>
          <dd
            data-testid="creature-added-on"
            class="text-lg font-semibold"
          >
            {{ addedOn }}
          </dd>
        </div>

        <div class="flex items-center justify-between border-t border-default py-4">
          <dt class="text-muted">
            在缸天數
          </dt>
          <dd
            data-testid="creature-days-in-tank"
            class="text-lg font-semibold"
          >
            {{ days }} 天
          </dd>
        </div>
      </dl>
    </template>
  </section>
</template>
