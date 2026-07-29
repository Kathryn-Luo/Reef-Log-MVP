import { expect, test } from '@playwright/test'

// 生物庫存（Epic #1 screen-5，issue #13）。
//
// 前提：preview 環境需有 seed 資料（`prisma/seed.ts`）——「主缸」有 12 隻生物：
// 魚 5（含 1 隻生病的火焰仙「白點」、1 隻跳缸死亡的六線龍）、珊瑚 6（含 1 隻生病）、其他 1。
// 資料量或狀態分布若有調整，這裡的數字要一併回頭改。
//
// 列的先後順序不驗：seed 是同一輪寫進去的，createdAt 可能落在同一秒，
// 排序在 preview 上不保證穩定。

test('頁首顯示標題、缸名與總隻數，右上角有新增按鈕', async ({ page }) => {
  await page.goto('/creatures')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('生物庫存')
  await expect(page.getByTestId('inventory-subtitle')).toHaveText('主缸 · 12 隻')
  await expect(page.getByTestId('creature-add')).toHaveAttribute('href', '/creatures/new')
})

// And 分類 tab 顯示「魚 · 5」「珊瑚 · 6」「其他 · 1」，各帶該分類的數量
// And 狀態 filter 顯示「全部 / 存活 / 生病 / 死亡」，預設選中「全部」
test('分類 tab 帶各分類數量，狀態 filter 預設選中「全部」', async ({ page }) => {
  await page.goto('/creatures')

  await expect(page.getByTestId('category-tab')).toHaveText(['魚 · 5', '珊瑚 · 6', '其他 · 1'])
  await expect(page.getByTestId('status-filter')).toHaveText(['全部', '存活', '生病', '死亡'])
  await expect(page.getByTestId('status-filter').first()).toHaveAttribute('aria-pressed', 'true')
})

// Given 我在「魚」分類且狀態 filter 為「全部」/ When 列表渲染
// Then 只顯示 category 為 FISH 的生物，包含存活、生病與死亡者
test('預設在「魚」分類，五隻魚含存活、生病與死亡都列出', async ({ page }) => {
  await page.goto('/creatures')

  await expect(page.getByTestId('category-tab').first()).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('creature-row')).toHaveCount(5)

  const statuses = await page.getByTestId('creature-row').evaluateAll(
    rows => rows.map(row => row.getAttribute('data-status')),
  )
  expect(new Set(statuses)).toEqual(new Set(['ALIVE', 'SICK', 'DEAD']))
})

// When 我點擊狀態「生病」/ Then 只顯示 status 為 SICK 的魚，該 filter chip 呈橘色選中態
test('點擊狀態「生病」後只剩生病的魚', async ({ page }) => {
  await page.goto('/creatures')

  const sick = page.getByTestId('status-filter').filter({ hasText: '生病' })
  await sick.click()

  await expect(sick).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('creature-row')).toHaveCount(1)
  await expect(page.getByTestId('creature-row')).toHaveAttribute('data-status', 'SICK')
  await expect(page.getByTestId('creature-status')).toHaveText('生病')

  // 分類 tab 的數量是分類總數，不隨狀態 filter 連動
  await expect(page.getByTestId('category-tab')).toHaveText(['魚 · 5', '珊瑚 · 6', '其他 · 1'])
})

test('切換分類 tab 後只顯示該分類的生物', async ({ page }) => {
  await page.goto('/creatures')

  await page.getByTestId('category-tab').nth(1).click()
  await expect(page.getByTestId('creature-row')).toHaveCount(6)

  await page.getByTestId('category-tab').nth(2).click()
  await expect(page.getByTestId('creature-row')).toHaveCount(1)
})

// Given 某隻存活生物有學名且入缸 8 個月 / Then 第二行顯示「<學名> · 入缸 N 月」
// Given 某隻生物狀態為生病 / Then 第二行顯示「<症狀> · 觀察第 N 天」
// Given 某隻生物狀態為死亡 / Then 第二行顯示「<死因> · MM / DD」
test('三種狀態的第二行各自顯示對應的推算內容', async ({ page }) => {
  await page.goto('/creatures')

  const rowOf = (status: string) => page.getByTestId('creature-row').filter({ has: page.locator(`[data-status="${status}"]`) }).first()

  await expect(rowOf('ALIVE').getByTestId('creature-subtitle')).toContainText(/入缸 \d+ 月/)
  await expect(rowOf('SICK').getByTestId('creature-subtitle')).toContainText(/白點 · 觀察第 \d+ 天/)
  await expect(rowOf('DEAD').getByTestId('creature-subtitle')).toContainText(/跳缸 · \d{2} \/ \d{2}/)
  await expect(rowOf('DEAD').getByTestId('creature-status')).toHaveText('死亡')
})

// Given 某隻生物俗名含有數量 / Then 正常顯示含有數量的俗名，不自動將該筆視為多隻生物
// seed 有兩隻同名的「公子小丑」——庫存列表是一隻一列，不合併成「×2」
test('同名的兩隻各佔一列，不合併成 ×N', async ({ page }) => {
  await page.goto('/creatures')

  await expect(page.getByTestId('creature-name').filter({ hasText: '公子小丑' })).toHaveCount(2)
  await expect(page.getByTestId('creature-name').filter({ hasText: '×2' })).toHaveCount(0)
})

// Given 目前的分類與狀態組合沒有任何生物 / Then 顯示空狀態文案，而非空白區塊
test('分類與狀態的組合沒有生物時顯示空狀態文案', async ({ page }) => {
  await page.goto('/creatures')

  await page.getByTestId('category-tab').nth(2).click()
  await page.getByTestId('status-filter').filter({ hasText: '死亡' }).click()

  await expect(page.getByTestId('creature-row')).toHaveCount(0)
  await expect(page.getByTestId('creature-empty')).toBeVisible()
})

// Given 我在生物庫存列表 / When 我點擊任一列 / Then 導向該生物的「生物詳情」頁
test('點擊任一列導向該生物的詳情頁', async ({ page }) => {
  await page.goto('/creatures')

  await page.getByTestId('creature-row').first().getByRole('link').click()

  await expect(page).toHaveURL(/\/creatures\/[^/]+$/)
  await expect(page.getByLabel('返回生物列表')).toBeVisible()
})
