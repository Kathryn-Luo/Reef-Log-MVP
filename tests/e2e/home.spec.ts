import { expect, test } from '@playwright/test'

// 首頁 · 生物優先（Epic #1 screen-1）。
//
// 前提：preview 環境需有 seed 資料——一位使用者、一個名為「主缸」的缸
// （4 尺 / SPS MIXED / 420L）、一筆數小時前的水質記錄與 12 隻生物。
// 目前 repo 內還沒有 migration 與 seed script（見 PR 說明的「已知缺口」），
// 這幾支 spec 要等資料備妥才會轉綠；unit 測試已完整覆蓋同樣的驗收條件。

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
