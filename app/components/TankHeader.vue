<script setup lang="ts">
import type { TankOption } from '#shared/types/home'

const props = withDefaults(defineProps<{
  tanks: TankOption[]
  currentTankId: string
  /** 頁面捲動時頁首收成兩層：副標讓位，只留「我在看哪一缸」需要的缸名與切換入口 */
  collapsed?: boolean
}>(), { collapsed: false })

const emit = defineEmits<{ select: [tankId: string] }>()

// 缸沒設色時退回主色，色塊不會變成一塊空白
const FALLBACK_COLOR = '#2dd4bf'
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

const open = ref(false)

const currentTank = computed(() => props.tanks.find(tank => tank.id === props.currentTankId) ?? props.tanks[0])

/** 「主缸 · 4 尺」——沒填 sizeSpec 時不留下孤零零的分隔點 */
function titleOf(tank: TankOption): string {
  return [tank.name, tank.sizeSpec].filter(Boolean).join(' · ')
}

const title = computed(() => (currentTank.value ? titleOf(currentTank.value) : ''))

/** 「SPS MIXED · 420L」 */
const subtitle = computed(() => {
  const tank = currentTank.value

  if (!tank) {
    return ''
  }

  return [tank.setupType, tank.volumeLiters === null ? null : `${tank.volumeLiters}L`]
    .filter(Boolean)
    .join(' · ')
})

const color = computed(() => {
  const hex = currentTank.value?.colorHex

  return hex && HEX_COLOR.test(hex) ? hex : FALLBACK_COLOR
})

/** 色塊底色是同一個色相的淡淡一層。8 碼 hex 各家瀏覽器支援不一，直接算成 rgba */
const tintedColor = computed(() => {
  const hex = color.value.slice(1)
  const full = hex.length === 3 ? [...hex].map(char => char + char).join('') : hex
  const channels = [0, 2, 4].map(offset => Number.parseInt(full.slice(offset, offset + 2), 16))

  return `rgba(${channels.join(', ')}, 0.14)`
})

function select(tankId: string) {
  open.value = false
  emit('select', tankId)
}
</script>

<template>
  <header
    class="px-4 transition-[padding] duration-200 ease-out motion-reduce:transition-none"
    :class="collapsed ? 'pt-2' : 'pt-4'"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="flex min-w-0 items-center gap-3">
        <span
          data-testid="tank-color"
          :data-color="color"
          :style="{ backgroundColor: tintedColor }"
          class="grid shrink-0 place-items-center rounded-2xl transition-[width,height] duration-200 ease-out motion-reduce:transition-none"
          :class="collapsed ? 'size-9' : 'size-12'"
        >
          <span
            class="rounded-[5px] transition-[width,height] duration-200 ease-out motion-reduce:transition-none"
            :class="collapsed ? 'size-3' : 'size-4'"
            :style="{ backgroundColor: color }"
          />
        </span>

        <div class="min-w-0">
          <div class="flex items-center gap-1">
            <h1
              class="truncate font-semibold transition-[font-size] duration-200 ease-out motion-reduce:transition-none"
              :class="collapsed ? 'text-lg' : 'text-xl'"
            >
              {{ title }}
            </h1>

            <button
              data-testid="tank-switch"
              type="button"
              aria-label="切換缸"
              aria-haspopup="listbox"
              :aria-expanded="open ? 'true' : 'false'"
              class="shrink-0 text-muted transition-colors hover:text-default"
              @click="open = !open"
            >
              <UIcon
                name="i-lucide-chevron-down"
                class="size-5"
              />
            </button>
          </div>

          <!--
            收合時副標整行讓位：缸名已經回答了「我在看哪一缸」，尺寸與水量捲回頂端再看。

            高度靠外層 grid 的 1fr → 0fr 補間，v-if 是節點的增減、CSS 補不了間（issue #55）。
            節點留在 DOM 裡，所以讓位時要一併 aria-hidden——
            不然螢幕報讀會念到畫面上看不見的那一行。
          -->
          <div
            data-testid="tank-subtitle-slot"
            :data-collapsed="collapsed ? 'true' : 'false'"
            :aria-hidden="collapsed ? 'true' : undefined"
            class="grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none"
            :class="collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'"
          >
            <!-- 上方間距給成內距，才會跟著高度一起收掉；外距不在軌道的量測範圍內 -->
            <p
              data-testid="tank-subtitle"
              class="min-h-0 truncate pt-0.5 font-mono text-sm text-muted"
            >
              {{ subtitle }}
            </p>
          </div>
        </div>
      </div>

      <!--
        issue #9 的「已知缺口」：右上角的圓形圖示在 schema.prisma 中沒有任何對應 model 或欄位，
        Epic 也沒說明其功能。先渲染為無作用的裝飾，實際行為待人類確認後另開 issue。
      -->
      <button
        data-testid="tank-header-ornament"
        type="button"
        disabled
        aria-hidden="true"
        tabindex="-1"
        class="grid shrink-0 place-items-center rounded-full border border-default text-dimmed transition-[width,height] duration-200 ease-out motion-reduce:transition-none"
        :class="collapsed ? 'size-9' : 'size-11'"
      >
        <UIcon
          name="i-lucide-sun"
          class="size-5"
        />
      </button>
    </div>

    <div
      v-if="open"
      data-testid="tank-menu"
      class="mt-3 overflow-hidden rounded-xl border border-default bg-elevated"
    >
      <ul
        role="listbox"
        aria-label="切換缸"
      >
        <li
          v-for="tank in tanks"
          :key="tank.id"
        >
          <button
            type="button"
            role="option"
            :aria-selected="tank.id === currentTankId ? 'true' : 'false'"
            class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accented"
            :class="tank.id === currentTankId ? 'text-primary' : 'text-default'"
            @click="select(tank.id)"
          >
            {{ titleOf(tank) }}
          </button>
        </li>
      </ul>

      <!--
        「新增缸」不是缸，所以留在 listbox 外面——混進 role="option" 裡的話，
        螢幕報讀會把它念成「可以切過去的第 N 個缸」。
      -->
      <NuxtLink
        data-testid="tank-menu-create"
        to="/tanks/new"
        class="flex w-full items-center gap-2 border-t border-default px-4 py-3 text-left text-sm font-semibold text-primary transition-colors hover:bg-accented"
        @click="open = false"
      >
        <UIcon
          name="i-lucide-plus"
          class="size-4"
        />
        新增缸
      </NuxtLink>
    </div>
  </header>
</template>
