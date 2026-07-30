import { expect, test } from '@playwright/test'

// 建立第一個缸（issue #46）。
//
// 前提：preview 環境的 seed 資料已經有一個「主缸」，所以首頁的空狀態在這裡看不到——
// 那一條由 unit 測試（tests/unit/pages/home.test.ts）覆蓋，這裡走「已有缸」的入口。
// E2E 不在 TDD Develop 的 job 內執行，跑在 Vercel preview URL 上。
//
// 這支會寫入資料庫（每跑一次建 3 個缸），刻意沒有清理——preview 的資料庫是該次
// Preview Deployment 專屬的 Neon 分支，缸隨分支一起回收。見 docs/PREVIEW_DATABASE.md（#52）。
// 該整合啟用前 preview 與 production 共用分支，此期間只能手動跑，不可接進 CI（#23）。

// Given 我已經有至少一個缸 / When 我點擊頁首缸名旁的 ∨
// Then 切換選單底部同樣有「新增缸」的入口
test('缸切換選單底部有「新增缸」的入口', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('tank-switch').click()

  const create = page.getByTestId('tank-menu-create')
  await expect(create).toBeVisible()
  await create.click()

  await expect(page).toHaveURL(/\/tanks\/new$/)
})

// Given 我在建立缸的表單 / When 我只填缸名就送出
// Then 建立一個屬於我的 Tank / And 導回首頁，該缸成為當前缸
test('填入缸名送出後導回首頁，新缸成為當前缸', async ({ page }) => {
  const name = `E2E 缸 ${Date.now()}`

  await page.goto('/tanks/new')
  await page.locator('input[name="name"]').fill(name)
  await page.locator('input[name="sizeSpec"]').fill('2 尺')
  await page.locator('input[name="startedOn"]').fill('2025-11-12')
  await page.getByTestId('tank-color-option').nth(1).click()
  await page.getByTestId('tank-form-submit').click()

  await expect(page).toHaveURL(/\/\?tank=/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${name} · 2 尺`)
})

// 標題列右上角的「儲存」與表單底部的是同一個動作
test('標題列的「儲存」同樣能建立缸', async ({ page }) => {
  const name = `E2E 頂欄缸 ${Date.now()}`

  await page.goto('/tanks/new')
  await page.locator('input[name="name"]').fill(name)
  await page.getByTestId('tank-header-submit').click()

  await expect(page).toHaveURL(/\/\?tank=/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
})

// And 水質摘要列與生物列表都顯示各自的空狀態
test('剛建立的缸水質與生物都是空狀態', async ({ page }) => {
  await page.goto('/tanks/new')
  await page.locator('input[name="name"]').fill(`E2E 空缸 ${Date.now()}`)
  await page.getByTestId('tank-form-submit').click()

  await expect(page.getByTestId('water-empty')).toBeVisible()
  await expect(page.getByTestId('creature-empty')).toBeVisible()
})

// 缸名是必填：沒填時「儲存」按不動，並說明原因
test('缸名沒填時儲存按鈕 disabled 並提示先填缸名', async ({ page }) => {
  await page.goto('/tanks/new')

  await expect(page.getByTestId('tank-form-submit')).toBeDisabled()
  await expect(page.getByTestId('tank-header-submit')).toBeDisabled()
  await expect(page.getByTestId('tank-form-hint')).toHaveText('請先填寫缸名')

  await page.locator('input[name="name"]').fill('主缸')
  await expect(page.getByTestId('tank-form-submit')).toBeEnabled()
})
