import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import TankHeader from '../../../app/components/TankHeader.vue'
import WaterSummaryCard from '../../../app/components/WaterSummaryCard.vue'
import type { TankOption, WaterSummaryDto } from '#shared/types/home'

// issue #55 起，收合時讓位的區塊都是同一套手法：外層 grid 由 1fr 補間到 0fr，
// 節點留在 DOM 裡（v-if 是節點的增減，CSS 補不了間）。
//
// issue #102：`tank-subtitle-slot` 收合後停在 2px 而不是 0，而 `water-readings-slot`
// 收得到 0。差的是「收合層自己不帶間距」這一層——`min-height: 0` 只收得掉 content box，
// `truncate` 帶的 `overflow: hidden` 也只裁內容，`pt-0.5` 那 2px padding 仍算在
// border box 裡，把 0fr 的軌道撐住。
//
// 兩個 slot 的收合手法本來就該是同一套，所以契約寫在一起：任何一邊走偏都會紅。
//
// unit 這一側沒有版面計算，量不到「收合後 0 高」本身，守的是「產生那個 0 的結構」。
// 實際高度由 `home.spec.ts` 在 preview 上收尾（見 tests/unit/e2e/subtitle-collapse-spec.test.ts）。

const MAIN_TANK: TankOption = {
  id: 'tank-1',
  name: '主缸',
  sizeSpec: '4 尺',
  volumeLiters: 420,
  setupType: 'SPS MIXED',
  colorHex: '#2dd4bf',
}

const WATER: WaterSummaryDto = {
  measuredAt: '2026-07-28T05:41:00.000Z',
  readings: [
    { parameter: 'KH', value: 7.8 },
    { parameter: 'CA', value: 412 },
    { parameter: 'MG', value: 1180 },
    { parameter: 'NO3', value: 12 },
    { parameter: 'PO4', value: 0.04 },
    { parameter: 'SALINITY', value: 1.026 },
  ],
  targets: [],
  trends: [],
}

/**
 * 會被算進 border box、因而不吃 `min-height: 0` 的間距 class。
 *
 * padding（`p-` / `pt-` / `py-`…）與框線寬度（`border` / `border-t` / `border-2`…）都屬於這一類；
 * `border-default` 之類的顏色 class 不加寬度，不在此列。
 */
const KEEPS_ITS_OWN_HEIGHT = /^(?:p[trblxyse]?-|border(?:-[trblxyse])?(?:-\d+)?$)/

/** 取收合層——`grid-rows-[0fr]` 的軌道量的就是這個直接子元素 */
function clipLayerOf(slot: Element): Element {
  const layer = slot.firstElementChild

  expect(layer, `${slot.getAttribute('data-testid')} 底下應該有一層收合層`).not.toBeNull()

  return layer!
}

function classesOf(element: Element): string[] {
  return [...element.classList]
}

const SLOTS = [
  {
    testId: 'tank-subtitle-slot',
    async mount() {
      return mountSuspended(TankHeader, {
        route: '/',
        props: { tanks: [MAIN_TANK], currentTankId: MAIN_TANK.id, collapsed: true },
      })
    },
  },
  {
    testId: 'water-readings-slot',
    async mount() {
      return mountSuspended(WaterSummaryCard, {
        route: '/',
        props: { water: WATER, now: new Date('2026-07-28T09:41:00.000Z'), collapsed: true },
      })
    },
  },
]

// Given 首頁的 sticky 頁首已因向下捲動而收合 / When 收合的過場播完
// Then tank-subtitle-slot 的高度為 0，與 water-readings-slot 一致
describe.each(SLOTS)('$testId 的收合層', ({ testId, mount }) => {
  it('是 slot 的直接子元素，由它負責裁切：min-h-0 + overflow-hidden', async () => {
    const wrapper = await mount()
    const layer = clipLayerOf(wrapper.get(`[data-testid="${testId}"]`).element)

    expect(classesOf(layer)).toContain('min-h-0')
    expect(classesOf(layer)).toContain('overflow-hidden')
  })

  it('自己不帶內距或框線——那些不吃 min-height: 0，會把 0fr 的軌道撐住', async () => {
    const wrapper = await mount()
    const layer = clipLayerOf(wrapper.get(`[data-testid="${testId}"]`).element)
    const offenders = classesOf(layer).filter(name => KEEPS_ITS_OWN_HEIGHT.test(name))

    expect(offenders, `收合層上的 ${offenders.join(' ')} 會留下自己的高度`).toEqual([])
  })

  it('間距擺在收合層裡面，跟著高度一起收掉', async () => {
    const wrapper = await mount()
    const layer = clipLayerOf(wrapper.get(`[data-testid="${testId}"]`).element)
    const inside = [...layer.querySelectorAll('*')].flatMap(classesOf)

    // 讓位的區塊與上一列之間本來就有間距，收合後那段間距必須一起消失，
    // 所以它只能長在收合層「裡面」——這裡確認它真的還在，沒有被順手刪掉
    expect(inside.some(name => /^[pm]t-/.test(name))).toBe(true)
  })
})
