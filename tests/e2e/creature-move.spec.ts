import { expect, test } from './support/guestSession'

// 移動到其他缸（issue #120）。
//
// 每個 test 開場先以訪客身分登入，各自拿到一份模板示範資料的複本（issue #80），
// 所以這裡的寫入（真的把生物換到另一個缸）只落在自己的沙盒裡。
//
// 前提：preview 環境需有 seed 資料（`prisma/seed.ts`）——「主缸」（預設缸）、
// 未封存的「小缸」與已封存的「舊缸」，主缸裡有「藍倒吊」與「火焰仙」。
// E2E 不在 TDD Develop 的 job 內執行，跑在 Vercel preview URL 上。

/** 從庫存列表點進指定俗名的那一隻（與 creature-detail.spec.ts 同一個作法，見那裡的註解） */
async function openCreature(page: import('@playwright/test').Page, name: string) {
  await page.goto('/creatures')
  await page.getByTestId('creature-row').filter({ hasText: name }).first().getByRole('link').click()
  await expect(page).toHaveURL(/\/creatures\/[^/]+$/)
  await expect(page.getByTestId('creature-taxonomy')).toBeVisible()
}

// Given 我正在查看自己生物的詳情，且名下有另一個未封存的缸
// When  我啟動「移動到其他缸」、選一個缸、確認送出
// Then  「所在缸」顯示為新的缸，原缸的庫存少了牠、目標缸多了牠
test('把生物移到自己的另一個缸，原缸少了牠、目標缸多了牠', async ({ page }) => {
  await openCreature(page, '藍倒吊')

  await expect(page.getByTestId('creature-current-tank')).toContainText('主缸')

  await page.getByTestId('creature-move-open').click()

  const sheet = page.getByTestId('creature-move-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByTestId('creature-move-subtitle')).toContainText('目前在')

  // 清單只有其他未封存的缸：目前所在的「主缸」與已封存的「舊缸」都不在裡面
  await expect(sheet.getByTestId('creature-move-option')).toHaveCount(1)
  await expect(sheet.getByTestId('creature-move-option')).toContainText('小缸')

  await sheet.getByTestId('creature-move-option').filter({ hasText: '小缸' }).click()

  // 確認鈕的文案帶著目的地，而不是抽象的「確定」
  await expect(page.getByTestId('creature-move-confirm')).toContainText('移動到小缸')
  await page.getByTestId('creature-move-confirm').click()

  await expect(page.getByTestId('creature-move-sheet')).toHaveCount(0)
  await expect(page.getByTestId('creature-current-tank')).toContainText('小缸')

  // 真的寫進去了，不只是畫面上改了
  await page.reload()
  await expect(page.getByTestId('creature-current-tank')).toContainText('小缸')

  // 原缸（庫存列表看的是預設缸「主缸」）少了牠
  await page.goto('/creatures')
  await expect(page.getByTestId('inventory-subtitle')).toBeVisible()
  await expect(page.getByTestId('creature-row').filter({ hasText: '藍倒吊' })).toHaveCount(0)

  // 目標缸多了牠：首頁切到「小缸」就看得到那張卡片
  await page.goto('/')
  await page.getByTestId('tank-switch').click()
  await page.getByTestId('tank-menu').getByRole('option').nth(1).click()
  await expect(page.getByTestId('creature-card').filter({ hasText: '藍倒吊' })).toHaveCount(1)
})

// Given API 回傳 404 / When 畫面收到錯誤
// Then 錯誤卡片指名該目標缸並明說生物沒有被移動，主要動作是「選其他缸」（沒有「重試」）
// And  畫面與資料都保持原狀
test('換缸失敗時畫面與資料保持原狀', async ({ page }) => {
  await openCreature(page, '火焰仙')

  // 目標缸在按下去的前一刻被封存或刪除，只有攔截造得出來——
  // 沙盒裡那個缸是好的，走真的 API 一定會成功。
  await page.route('**/api/creatures/*/move', route => route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({ statusCode: 404, statusMessage: 'Tank not found' }),
  }))

  await page.getByTestId('creature-move-open').click()
  await page.getByTestId('creature-move-option').filter({ hasText: '小缸' }).click()
  await page.getByTestId('creature-move-confirm').click()

  const error = page.getByTestId('creature-move-error')
  await expect(error).toContainText('移動失敗')
  await expect(error).toContainText('小缸')
  await expect(error).toContainText('未被移動')

  // 主要動作是「選其他缸」；重送同一個目標沒有意義，所以畫面上沒有「重試」
  await expect(page.getByTestId('creature-move-confirm')).toContainText('選其他缸')
  await expect(page.getByTestId('creature-move-sheet')).not.toContainText('重試')

  // 不做樂觀更新：副標與詳情頁的「所在缸」自始至終都是主缸
  await expect(page.getByTestId('creature-move-subtitle')).toContainText('仍在')
  await expect(page.getByTestId('creature-current-tank')).toContainText('主缸')

  // 資料也沒有動：拿掉攔截、重新整理，牠仍在主缸，主缸的庫存也還看得到牠
  await page.unroute('**/api/creatures/*/move')
  await page.reload()
  await expect(page.getByTestId('creature-current-tank')).toContainText('主缸')

  await page.goto('/creatures')
  await expect(page.getByTestId('creature-row').filter({ hasText: '火焰仙' })).toHaveCount(1)
})
