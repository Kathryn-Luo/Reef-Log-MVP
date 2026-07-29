import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import WaterDashboardSheet from '../../../app/components/WaterDashboardSheet.vue'
import type { WaterSummaryDto } from '#shared/types/home'

const NOW = new Date('2026-07-28T09:41:00.000Z')

// Given 該缸最新一筆水質記錄包含六個測項，量測於 4 小時前
// 區間取 screen-2 右側標示的六組（該缸自己設定的 WaterParameterTarget）
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
  targets: [
    { parameter: 'KH', minValue: 7, maxValue: 9 },
    { parameter: 'CA', minValue: 380, maxValue: 450 },
    { parameter: 'MG', minValue: 1250, maxValue: 1350 },
    { parameter: 'NO3', minValue: 2, maxValue: 10 },
    { parameter: 'PO4', minValue: 0.02, maxValue: 0.1 },
    { parameter: 'SALINITY', minValue: 1.024, maxValue: 1.027 },
  ],
  trends: [
    { parameter: 'KH', values: [7.6, 7.9, 7.8] },
    { parameter: 'MG', values: [1300, 1260, 1180] },
    { parameter: 'NO3', values: [9, 10.5, 12] },
  ],
}

function mountSheet(props: {
  open?: boolean
  water?: WaterSummaryDto | null
  tankName?: string
} = {}) {
  return mountSuspended(WaterDashboardSheet, {
    route: '/',
    props: {
      open: true,
      tankName: '主缸',
      water: WATER,
      now: NOW,
      ...props,
    },
  })
}

type Sheet = Awaited<ReturnType<typeof mountSheet>>

function rows(sheet: Sheet) {
  return sheet.findAll('[data-testid="water-dashboard-row"]')
}

function rowOf(sheet: Sheet, parameter: string) {
  return sheet.get(`[data-testid="water-dashboard-row"][data-parameter="${parameter}"]`)
}

/** 把 bg-black/60 這種半透明 class 的透明度取出來 */
function backdropOpacity(classes: string[]): number {
  const token = classes.find(name => /^bg-[a-z-]+\/\d+$/.test(name))

  expect(token, `預期遮罩帶著 bg-<色>/<透明度>，實際為 ${classes.join(' ')}`).toBeDefined()

  return Number(token!.split('/')[1])
}

describe('WaterDashboardSheet — 展開後的內容', () => {
  // Then 由下方升起 bottom sheet，標題為「數據儀表板」，副標為「<缸名> · 更新於 N 小時前」
  it('標題為「數據儀表板」，副標帶缸名與相對時間', async () => {
    const sheet = await mountSheet()

    expect(sheet.get('[data-testid="water-dashboard-title"]').text()).toBe('數據儀表板')
    expect(sheet.get('[data-testid="water-dashboard-subtitle"]').text()).toBe('主缸 · 更新於 4 小時前')
  })

  it('缸名跟著當前缸走', async () => {
    const sheet = await mountSheet({ tankName: '軟體缸' })

    expect(sheet.get('[data-testid="water-dashboard-subtitle"]').text()).toBe('軟體缸 · 更新於 4 小時前')
  })

  // And 背景首頁內容變暗但仍可見
  it('背景遮罩讓首頁變暗但不遮死', async () => {
    const sheet = await mountSheet()
    const backdrop = sheet.get('[data-testid="water-dashboard-backdrop"]')

    // 全不透明就看不見首頁了，全透明則稱不上「變暗」
    const opacity = backdropOpacity(backdrop.classes())
    expect(opacity).toBeGreaterThan(0)
    expect(opacity).toBeLessThan(100)
  })

  // 由下方升起：面板貼齊底部，遮罩鋪滿整個畫面
  it('面板由畫面底部升起，覆蓋在首頁與底部 tab 列之上', async () => {
    const sheet = await mountSheet()
    const root = sheet.get('[data-testid="water-dashboard"]')
    const panel = sheet.get('[data-testid="water-dashboard-sheet"]')

    expect(root.classes()).toContain('fixed')
    expect(root.classes()).toContain('inset-0')
    expect(panel.classes()).toContain('bottom-0')

    // 底部 tab 列是 z-50，儀表板必須疊在它上面才蓋得住
    const layer = root.classes().find(name => /^z-\[\d+\]$/.test(name))
    expect(layer, `預期根層帶著 z-[<n>]，實際為 ${root.classes().join(' ')}`).toBeDefined()
    expect(Number(layer!.slice('z-['.length, -1))).toBeGreaterThan(50)
  })

  it('是一個 modal dialog，並以標題命名', async () => {
    const sheet = await mountSheet()
    const panel = sheet.get('[data-testid="water-dashboard-sheet"]')

    expect(panel.attributes('role')).toBe('dialog')
    expect(panel.attributes('aria-modal')).toBe('true')
    expect(panel.attributes('aria-labelledby')).toBe(
      sheet.get('[data-testid="water-dashboard-title"]').attributes('id'),
    )
  })

  // Given 我在首頁，水質摘要列為收合狀態（尚未點開）
  it('open 為 false 時整個不渲染', async () => {
    const sheet = await mountSheet({ open: false })

    expect(sheet.find('[data-testid="water-dashboard"]').exists()).toBe(false)
    expect(rows(sheet)).toHaveLength(0)
  })
})

describe('WaterDashboardSheet — 六列測項', () => {
  // Then 依序列出 KH / Ca / Mg / NO₃ / PO₄ / 鹽度六列
  it('依序六列，順序與 screen-2 一致', async () => {
    const sheet = await mountSheet()

    expect(rows(sheet)).toHaveLength(6)
    expect(rows(sheet).map(row => row.attributes('data-parameter'))).toEqual([
      'KH',
      'CA',
      'MG',
      'NO3',
      'PO4',
      'SALINITY',
    ])
    expect(
      sheet.findAll('[data-testid="water-dashboard-label"]').map(label => label.text()),
    ).toEqual(['KH', 'Ca', 'Mg', 'NO₃', 'PO₄', '鹽度'])
  })

  // And 每列顯示：測項名、數值、單位（dKH / ppm / ppm / ppm / ppm / SG）、迷你趨勢線、狀態文字與區間
  it('每列都有數值、單位、狀態文字與區間', async () => {
    const sheet = await mountSheet()

    expect(
      sheet.findAll('[data-testid="water-dashboard-value"]').map(value => value.text()),
    ).toEqual(['7.8', '412', '1180', '12', '.04', '1.026'])

    expect(
      sheet.findAll('[data-testid="water-dashboard-unit"]').map(unit => unit.text()),
    ).toEqual(['dKH', 'ppm', 'ppm', 'ppm', 'ppm', 'SG'])

    expect(
      sheet.findAll('[data-testid="water-dashboard-range"]').map(range => range.text()),
    ).toEqual(['7–9', '380–450', '1250–1350', '2–10', '.02–.10', '1.024–1.027'])

    expect(
      sheet.findAll('[data-testid="water-dashboard-status"]').map(status => status.text()),
    ).toEqual(['正常', '正常', '偏低 ▼', '偏高 ▲', '正常', '正常'])
  })

  // 迷你趨勢線：有兩筆以上讀數才畫得出走勢
  it('有歷史讀數的測項畫出折線，只有一筆的不畫', async () => {
    const sheet = await mountSheet()

    expect(rowOf(sheet, 'MG').get('[data-testid="water-dashboard-trend"]').exists()).toBe(true)
    expect(rowOf(sheet, 'MG').get('polyline').attributes('points')).toBeTruthy()

    // Ca / PO₄ / 鹽度 這次沒有歷史點，不硬畫一條假的線
    expect(rowOf(sheet, 'CA').find('[data-testid="water-dashboard-trend"]').exists()).toBe(false)
  })

  // Given Mg 的最新值為 1180，該缸 Mg 的正常區間為 1250–1350
  // Then 右側顯示藍色「偏低 ▼」與區間文字「1250–1350」，數值同樣以藍色呈現
  it('Mg 偏低：數值與狀態文字都是藍色', async () => {
    const row = rowOf(await mountSheet(), 'MG')
    const value = row.get('[data-testid="water-dashboard-value"]')
    const status = row.get('[data-testid="water-dashboard-status"]')

    expect(value.attributes('data-status')).toBe('low')
    expect(value.text()).toBe('1180')
    expect(value.classes()).toContain('text-blue-400')

    expect(status.text()).toBe('偏低 ▼')
    expect(status.classes()).toContain('text-blue-400')
    expect(row.get('[data-testid="water-dashboard-range"]').text()).toBe('1250–1350')
  })

  // Given NO₃ 的最新值為 12，該缸 NO₃ 的正常區間為 2–10
  // Then 右側顯示橘色「偏高 ▲」與區間文字「2–10」，數值同樣以橘色呈現
  it('NO₃ 偏高：數值與狀態文字都是橘色', async () => {
    const row = rowOf(await mountSheet(), 'NO3')
    const value = row.get('[data-testid="water-dashboard-value"]')
    const status = row.get('[data-testid="water-dashboard-status"]')

    expect(value.attributes('data-status')).toBe('high')
    expect(value.text()).toBe('12')
    expect(value.classes()).toContain('text-amber-400')

    expect(status.text()).toBe('偏高 ▲')
    expect(status.classes()).toContain('text-amber-400')
    expect(row.get('[data-testid="water-dashboard-range"]').text()).toBe('2–10')
  })

  // Given KH 的最新值為 7.8，落在正常區間 7–9 內
  // Then 右側顯示「正常」與區間文字「7–9」
  it('KH 正常：狀態文字為「正常」，不帶方向箭頭', async () => {
    const row = rowOf(await mountSheet(), 'KH')

    expect(row.get('[data-testid="water-dashboard-value"]').attributes('data-status')).toBe('normal')
    expect(row.get('[data-testid="water-dashboard-status"]').text()).toBe('正常')
    expect(row.get('[data-testid="water-dashboard-range"]').text()).toBe('7–9')
  })

  // Given 該缸最新一筆記錄中某測項未填寫（該測項無 reading）
  // Then 該列數值顯示「—」，不顯示狀態文字
  it('未填寫的測項顯示「—」，該列沒有狀態文字', async () => {
    const sheet = await mountSheet({
      water: { ...WATER, readings: [{ parameter: 'KH', value: 7.8 }] },
    })

    // 六列照樣到齊
    expect(rows(sheet)).toHaveLength(6)

    const missing = rowOf(sheet, 'PO4')
    expect(missing.get('[data-testid="water-dashboard-value"]').text()).toBe('—')
    expect(missing.get('[data-testid="water-dashboard-value"]').attributes('data-status')).toBeUndefined()
    expect(missing.find('[data-testid="water-dashboard-status"]').exists()).toBe(false)

    // 區間是這一列的參考值，沒量到也照樣標出來
    expect(missing.get('[data-testid="water-dashboard-range"]').text()).toBe('.02–.10')

    // 有量到的那一列不受影響
    expect(rowOf(sheet, 'KH').get('[data-testid="water-dashboard-status"]').text()).toBe('正常')
  })
})

describe('WaterDashboardSheet — 三種關閉手勢', () => {
  // Given 儀表板已展開 / When 我點擊右上角 ✕ / Then bottom sheet 收合
  it('點擊右上角 ✕ 送出 close', async () => {
    const sheet = await mountSheet()

    await sheet.get('[data-testid="water-dashboard-close"]').trigger('click')

    expect(sheet.emitted('close')).toHaveLength(1)
  })

  it('✕ 有無障礙名稱', async () => {
    const sheet = await mountSheet()

    expect(sheet.get('[data-testid="water-dashboard-close"]').attributes('aria-label')).toBe('關閉')
  })

  // When 我點擊背景遮罩 / Then bottom sheet 收合
  it('點擊背景遮罩送出 close', async () => {
    const sheet = await mountSheet()

    await sheet.get('[data-testid="water-dashboard-backdrop"]').trigger('click')

    expect(sheet.emitted('close')).toHaveLength(1)
  })

  // 點在面板上是「操作內容」，不是「想關掉」
  it('點擊面板本身不會關閉', async () => {
    const sheet = await mountSheet()

    await sheet.get('[data-testid="water-dashboard-sheet"]').trigger('click')
    await rowOf(sheet, 'KH').trigger('click')

    expect(sheet.emitted('close')).toBeUndefined()
  })

  // When 我向下拖曳把手 / Then bottom sheet 收合
  it('向下拖曳把手超過門檻送出 close', async () => {
    const sheet = await mountSheet()

    await sheet.get('[data-testid="water-dashboard-handle"]').trigger('pointerdown', { clientY: 100 })
    await sheet.get('[data-testid="water-dashboard"]').trigger('pointermove', { clientY: 200 })
    await sheet.get('[data-testid="water-dashboard"]').trigger('pointerup', { clientY: 220 })

    expect(sheet.emitted('close')).toHaveLength(1)
  })

  // 拖一點點就關掉會很難用，鬆手後要彈回原位
  it('只拖一小段就放開時不關閉，面板彈回原位', async () => {
    const sheet = await mountSheet()
    const handle = sheet.get('[data-testid="water-dashboard-handle"]')
    const root = sheet.get('[data-testid="water-dashboard"]')
    const panel = sheet.get('[data-testid="water-dashboard-sheet"]')

    await handle.trigger('pointerdown', { clientY: 100 })
    await root.trigger('pointermove', { clientY: 112 })

    // 拖曳過程中面板跟著手指走，才看得出是「拖」而不是「點」
    expect(panel.attributes('style')).toContain('translateY(12px)')

    await root.trigger('pointerup', { clientY: 112 })

    expect(sheet.emitted('close')).toBeUndefined()
    expect(panel.attributes('style') ?? '').not.toContain('translateY(12px)')
  })

  // 往上拖不是關閉手勢，面板也不該被拉出畫面上緣
  it('向上拖曳不關閉，面板也不跟著往上跑', async () => {
    const sheet = await mountSheet()
    const root = sheet.get('[data-testid="water-dashboard"]')

    await sheet.get('[data-testid="water-dashboard-handle"]').trigger('pointerdown', { clientY: 200 })
    await root.trigger('pointermove', { clientY: 40 })

    expect(sheet.get('[data-testid="water-dashboard-sheet"]').attributes('style') ?? '')
      .not.toContain('translateY(-')

    await root.trigger('pointerup', { clientY: 40 })

    expect(sheet.emitted('close')).toBeUndefined()
  })

  // 沒有按住把手就滑過去的，是捲動內容而不是拖曳面板
  it('沒有先按住把手的移動不會拖動面板', async () => {
    const sheet = await mountSheet()
    const root = sheet.get('[data-testid="water-dashboard"]')

    await root.trigger('pointermove', { clientY: 300 })
    await root.trigger('pointerup', { clientY: 300 })

    expect(sheet.get('[data-testid="water-dashboard-sheet"]').attributes('style') ?? '')
      .not.toContain('translateY')
    expect(sheet.emitted('close')).toBeUndefined()
  })

  // role="dialog" + aria-modal 的鍵盤慣例，滑鼠以外的使用者也要出得去
  it('按 Esc 送出 close', async () => {
    const sheet = await mountSheet()

    await sheet.get('[data-testid="water-dashboard"]').trigger('keydown', { key: 'Escape' })

    expect(sheet.emitted('close')).toHaveLength(1)
  })
})

describe('WaterDashboardSheet — 記錄水質', () => {
  // Given 儀表板已展開 / When 我點擊底部的「＋ 記錄水質」主要按鈕
  // Then bottom sheet 關閉並導向「記錄水質」頁面
  it('「＋ 記錄水質」連向 /log，點擊時一併收合', async () => {
    const sheet = await mountSheet()
    const action = sheet.get('[data-testid="water-dashboard-log"]')

    expect(action.text()).toContain('記錄水質')
    expect(action.attributes('href')).toBe('/log')

    await action.trigger('click')

    expect(sheet.emitted('close')).toHaveLength(1)
  })
})
