import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// 首頁 · 生物優先（Epic #1 screen-1）。
//
// 前提：preview 環境需有 seed 資料（`prisma/seed.ts`，PR #49）——一位使用者、
// 一個名為「主缸」的缸（4 尺 / SPS MIXED / 420L）、一筆數小時前的水質記錄與 12 隻生物，
// 外加兩個尚無水質記錄的缸。sticky 的 spec 需要生物多到捲得動，資料量變少時要一併回頭調整。

// Given 我有一個名為「主缸」的缸，設定為 4 尺 / SPS MIXED / 420L / When 我開啟首頁
// Then 頁首顯示缸的代表色塊、缸名「主缸 · 4 尺」與副標「SPS MIXED · 420L」，缸名右側有可切換的 ∨
test('頁首顯示缸名、副標與色塊', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('主缸 · 4 尺')
  await expect(page.getByTestId('tank-subtitle')).toHaveText('SPS MIXED · 420L')
  await expect(page.getByTestId('tank-color')).toBeVisible()
  await expect(page.getByTestId('tank-switch')).toBeVisible()
})

// Given 我有兩個以上未封存的缸 / When 我點擊缸名旁的 ∨ / Then 出現缸切換選單
// When 我選擇另一個缸 / Then 首頁的水質摘要與生物列表改為顯示該缸的資料
test('切換缸之後水質摘要與生物列表跟著換', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('tank-switch').click()

  const options = page.getByTestId('tank-menu').getByRole('option')
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')

  const before = await page.getByRole('heading', { level: 1 }).textContent()
  await options.nth(1).click()

  await expect(page.getByTestId('tank-menu')).toBeHidden()
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(before ?? '')
})

// Given 該缸最新一筆水質記錄為 4 小時前，其中 Mg 低於正常區間、NO₃ 高於正常區間
// Then 顯示「水質」標題、橘色徽章「2 需注意」與相對時間
// And 六項元素 KH / Ca / Mg / NO₃ / PO₄ / 鹽 以彩色數字並排顯示
// And 正常項為綠色、偏低為藍色、偏高為橘色
test('水質摘要列顯示需注意數量、相對時間與六項彩色數字', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('water-title')).toHaveText('水質')
  await expect(page.getByTestId('water-attention')).toHaveText('2 需注意')
  await expect(page.getByTestId('water-measured-at')).toContainText('·')

  await expect(page.getByTestId('water-reading-label')).toHaveText(['KH', 'Ca', 'Mg', 'NO₃', 'PO₄', '鹽'])

  const values = page.getByTestId('water-reading-value')
  await expect(values.nth(2)).toHaveAttribute('data-status', 'low')
  await expect(values.nth(3)).toHaveAttribute('data-status', 'high')
})

// Given 該缸有 12 隻生物：魚 5、珊瑚 6、其他 1
// Then 「生物」標題右側顯示「12 隻」，並有 4 個分類 chip：全部 / 魚 5 / 珊瑚 6 / 其他 1
// When 我點擊「魚 5」/ Then 卡片網格只顯示 category 為 FISH 的生物，該 chip 呈選中態
test('分類 chip 篩選出對應分類的生物', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('creature-total')).toHaveText('12 隻')
  await expect(page.getByTestId('creature-chip')).toHaveText(['全部', '魚 5', '珊瑚 6', '其他 1'])

  const fishChip = page.getByTestId('creature-chip').nth(1)
  await fishChip.click()

  await expect(fishChip).toHaveAttribute('aria-pressed', 'true')
  const categories = await page.getByTestId('creature-category').allTextContents()
  expect(new Set(categories)).toEqual(new Set(['魚']))
})

// Given 生物卡片網格中有存活、生病、死亡三種狀態的生物 / When 卡片渲染
// Then 狀態點分別為存活綠 / 生病橘 / 死亡灰，生病卡片顯示「⚠ 觀察中」
// Given 該缸有兩隻同名的「公子小丑」/ Then 兩者合併為一張「公子小丑 ×2」
test('卡片顯示分類、狀態與同名合併的 ×N', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('creature-card').first()).toBeVisible()
  await expect(page.getByTestId('creature-watch-flag').first()).toContainText('觀察中')
  await expect(page.getByTestId('creature-title').filter({ hasText: '×2' })).toHaveCount(1)
})

// Given 我在首頁 / When 我點擊任一張生物卡片 / Then 導向該生物的「生物詳情」頁
test('點擊生物卡片導向生物詳情頁', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('creature-card').first().getByRole('link').click()

  await expect(page).toHaveURL(/\/creatures\/[^/]+$/)
})

// ── sticky 頁首（issue #48）────────────────────────────────────────────────
//
// 手機尺寸才是這個 Story 的情境：12 隻生物在 390×844 下必定超過一個螢幕。

/** 捲到指定位置（超過頁面高度就捲到底），再等捲動位置定下來才回傳 */
async function scrollTo(page: Page, offset: number) {
  const target = await page.evaluate((top) => {
    const max = document.documentElement.scrollHeight - window.innerHeight
    const clamped = Math.max(0, Math.min(top, max))

    window.scrollTo({ top: clamped, behavior: 'instant' })

    return clamped
  }, offset)

  await page.waitForFunction(top => Math.abs(window.scrollY - top) < 2, target)
}

test.describe('sticky 頁首', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  // Given 我在首頁且生物卡片多到可以捲動 / When 我向下捲動
  // Then 缸別頁首與水質摘要列固定在畫面頂端，持續可見
  // And 水質摘要列的六項元素在捲動全程都顯示，不收合、內容不改變
  // Then「生物 N 隻」標題列與分類 chip 列隨卡片網格一起捲離畫面，不固定在頂端
  test('向下捲動後頁首與水質列留在畫面上，標題列與 chip 列捲離畫面', async ({ page }) => {
    await page.goto('/')

    const heading = page.getByRole('heading', { level: 1 })
    const waterTitle = page.getByTestId('water-title')
    const total = page.getByTestId('creature-total')
    const firstChip = page.getByTestId('creature-chip').first()

    // 未捲動時五個區塊都在
    await expect(heading).toBeInViewport()
    await expect(total).toBeInViewport()
    await expect(firstChip).toBeInViewport()
    const readingsAtTop = await page.getByTestId('water-reading-value').allTextContents()
    expect(readingsAtTop).toHaveLength(6)

    await scrollTo(page, 1200)

    await expect(heading).toBeInViewport()
    await expect(waterTitle).toBeInViewport()
    await expect(total).not.toBeInViewport()
    await expect(firstChip).not.toBeInViewport()

    // 六項元素全程顯示，數值也沒有變成別的樣子
    await expect(page.getByTestId('water-reading')).toHaveCount(6)
    expect(await page.getByTestId('water-reading-value').allTextContents()).toEqual(readingsAtTop)
  })

  // Given 我向下捲動，生物卡片正從固定的頁首下方通過 / When 我觀察兩者交界
  // Then 卡片被頁首遮住而不是蓋在頁首上（頁首在上層）
  test('生物卡片從固定的頁首下方穿過，頁首在上層', async ({ page }) => {
    await page.goto('/')
    await scrollTo(page, 1200)

    const header = page.getByTestId('home-sticky-header')
    const box = (await header.boundingBox())!

    // 頁首底邊上方一點的位置，此時正有生物卡片經過——命中的必須是頁首而不是卡片
    const hit = await page.evaluate(
      point => document.elementFromPoint(point.x, point.y)?.closest('[data-testid]')?.getAttribute('data-testid') ?? null,
      { x: box.x + box.width / 2, y: box.y + box.height - 4 },
    )

    expect(hit).not.toBe('creature-card')
    await expect(header).toBeInViewport()
  })

  // Given 我向下捲動後再向上捲回頂端 / When 捲動位置回到 0
  // Then 版面回到初始樣態，與「尚未捲動」時一致
  test('捲回頂端後版面回到初始樣態', async ({ page }) => {
    await page.goto('/')

    const total = page.getByTestId('creature-total')
    const before = await page.getByTestId('home-sticky-header').innerHTML()

    await scrollTo(page, 1200)
    await scrollTo(page, 0)

    await expect(total).toBeInViewport()
    await expect(page.getByTestId('creature-chip').first()).toBeInViewport()
    expect(await page.getByTestId('home-sticky-header').innerHTML()).toBe(before)
  })

  // Given 固定的頁首與底部 tab 列同時在畫面上 / When 我捲動頁面
  // Then 底部 tab 列位置與外觀不變，且不被固定的頁首覆蓋
  test('底部 tab 列不受固定頁首影響', async ({ page }) => {
    await page.goto('/')

    const tabBar = page.getByRole('navigation', { name: '主要導覽' })
    const before = await tabBar.boundingBox()

    await scrollTo(page, 1200)

    await expect(tabBar).toBeInViewport()
    expect(await tabBar.boundingBox()).toEqual(before)

    // 五個 tab 都還點得到——被頁首蓋住的話這裡會逾時
    await expect(tabBar.getByRole('link')).toHaveCount(5)
    await tabBar.getByRole('link').nth(2).click()
    await expect(page).toHaveURL(/\/trends$/)
  })

  // Given 頁首已固定在頂端 / When 我點開切換缸的下拉選單
  // Then 選單完整顯示在生物卡片之上，不被卡片蓋住、不被 sticky 區裁切
  test('固定狀態下切換缸的選單完整顯示在卡片之上', async ({ page }) => {
    await page.goto('/')
    await scrollTo(page, 1200)

    await page.getByTestId('tank-switch').click()

    const menu = page.getByTestId('tank-menu')
    await expect(menu).toBeVisible()
    await expect(menu).toBeInViewport()

    // 每一個選項都點得到——被卡片蓋住或被容器裁掉的話這裡會失敗
    const options = menu.getByRole('option')
    await expect(options.first()).toBeVisible()
    await expect(options.last()).toBeVisible()

    const box = (await options.last().boundingBox())!
    const hit = await page.evaluate(
      point => document.elementFromPoint(point.x, point.y)?.closest('[data-testid]')?.getAttribute('data-testid') ?? null,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    )
    expect(hit).toBe('tank-menu')
  })

  // Given 該缸尚無任何水質記錄 / When 我向下捲動
  // Then 頁首與水質摘要列照常固定在頂端，水質摘要列維持空狀態內容，不顯示需注意徽章
  //
  // seed 的「小缸」沒有水質記錄，改看它即可（tank-menu 的第二個選項）。
  test('沒有水質記錄的缸，固定的水質摘要列維持空狀態', async ({ page }) => {
    await page.goto('/')

    await page.getByTestId('tank-switch').click()
    await page.getByTestId('tank-menu').getByRole('option').nth(1).click()
    await expect(page.getByTestId('water-empty')).toBeVisible()

    await scrollTo(page, 600)

    await expect(page.getByTestId('water-title')).toBeInViewport()
    await expect(page.getByTestId('water-empty')).toBeInViewport()
    await expect(page.getByTestId('water-empty-action')).toHaveText('記錄水質')
    await expect(page.getByTestId('water-attention')).toHaveCount(0)
  })
})
