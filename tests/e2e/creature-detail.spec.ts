import { expect, test } from '@playwright/test'

// 生物詳情 · 死亡記錄（Epic #1 screen-6，issue #14）。
//
// 前提：preview 環境需有 seed 資料（`prisma/seed.ts`）——「主缸」的魚裡有
// 一隻跳缸死亡的「六線龍」與一隻生病（白點）的「火焰仙」。
// E2E 不在 TDD Develop 的 job 內執行，跑在 Vercel preview URL 上。
//
// preview 與 production 目前共用同一個 Neon 分支（見 CLAUDE.md），
// 所以這裡唯一會寫入的那個測試在結束前把六線龍改回原本的死亡記錄——
// 其他 spec（tests/e2e/creatures.spec.ts）數的是同一批 seed 資料。

/** 從庫存列表點進指定俗名的那一隻 */
async function openCreature(page: import('@playwright/test').Page, name: string) {
  await page.goto('/creatures')
  await page.getByTestId('creature-row').filter({ hasText: name }).first().getByRole('link').click()
  await expect(page).toHaveURL(/\/creatures\/[^/]+$/)

  // #84 關掉 SSR 改走 SPA 之後，URL 換得比畫面早：詳情頁的 `useAsyncData` 還沒回來時
  // 畫面仍停在列表上，`getByTestId('creature-name')` 會同時命中列表的 5 個列，
  // 呼叫端的斷言就撞上 strict mode violation（issue #95）。
  //
  // 所以再等一個「只有詳情頁才有」的元素。`creature-taxonomy` 出現在
  // app/pages/creatures/[id].vue，列表頁沒有它——它出現就代表換的是畫面，不只是網址。
  await expect(page.getByTestId('creature-taxonomy')).toBeVisible()
}

// Given 我從首頁或生物庫存點進某隻生物 / When 詳情頁載入
// Then 顯示照片、俗名、學名，以及「<分類> · <細分類>」標籤
// And 頁首左側有 ← 返回、右側有「編輯」
test('詳情頁顯示俗名、學名、分類標籤，頁首有返回與編輯', async ({ page }) => {
  await openCreature(page, '六線龍')

  await expect(page.getByTestId('creature-name')).toHaveText('六線龍')
  await expect(page.getByTestId('creature-scientific-name')).toHaveText('Pseudocheilinus hexataenia')
  await expect(page.getByTestId('creature-taxonomy')).toHaveText('魚 · 龍魚')
  await expect(page.getByTestId('creature-back')).toHaveAttribute('href', '/creatures')
  await expect(page.getByTestId('creature-edit')).toBeVisible()
})

// Given 我在詳情頁 / When 畫面載入
// Then 「狀態」區顯示三個互斥選項：存活 / 生病 / 死亡，且目前狀態呈選中態
test('狀態三選一，目前狀態呈選中態，死亡者展開死亡記錄', async ({ page }) => {
  await openCreature(page, '六線龍')

  await expect(page.getByTestId('status-option')).toHaveText(['存活', '生病', '死亡'])
  await expect(page.getByTestId('status-option').nth(2)).toHaveAttribute('aria-pressed', 'true')

  const record = page.getByTestId('death-record')
  await expect(record).toBeVisible()
  await expect(record.getByTestId('death-cause-option')).toHaveCount(6)
  await expect(record.getByTestId('death-cause-option').filter({ hasText: '跳缸' }))
    .toHaveAttribute('aria-pressed', 'true')
  await expect(record.locator('input[name="diedOn"]')).not.toHaveValue('')
})

// 「儲存」在「狀態」區任一值變更後才出現（PR #58 review）
test('沒改任何東西時看不到儲存，改了狀態才出現', async ({ page }) => {
  await openCreature(page, '六線龍')

  await expect(page.getByTestId('creature-save')).toHaveCount(0)

  await page.getByTestId('status-option').filter({ hasText: '生病' }).click()
  await expect(page.getByTestId('creature-save')).toBeVisible()

  // 改回原本的狀態就沒有東西可存了，按鈕跟著收起來
  await page.getByTestId('status-option').filter({ hasText: '死亡' }).click()
  await expect(page.getByTestId('creature-save')).toHaveCount(0)
})

// Given 某生物於 <入缸日> 入缸、於 <死亡日> 死亡 / When 詳情頁載入
// Then 底部顯示「入缸日 YYYY / MM / DD」與「在缸天數 N 天」
test('底部顯示入缸日與在缸天數', async ({ page }) => {
  await openCreature(page, '六線龍')

  await expect(page.getByTestId('creature-added-on')).toHaveText(/^\d{4} \/ \d{2} \/ \d{2}$/)
  // seed 的六線龍：入缸 250 天前、死亡 70 天前 → 在缸 180 天
  await expect(page.getByTestId('creature-days-in-tank')).toHaveText('180 天')
})

// Given 我把狀態切為「生病」/ When 區塊渲染
// Then 顯示發病日與症狀欄位（不要求死亡日與死因）
test('切到「生病」只出現發病日與症狀', async ({ page }) => {
  await openCreature(page, '藍倒吊')

  await page.getByTestId('status-option').filter({ hasText: '生病' }).click()

  const record = page.getByTestId('sick-record')
  await expect(record.locator('input[name="observedSickOn"]')).toBeVisible()
  await expect(record.locator('input[name="ailment"]')).toBeVisible()
  await expect(page.locator('input[name="diedOn"]')).toHaveCount(0)
  await expect(page.getByTestId('death-cause-option')).toHaveCount(0)
})

// Given 我選擇狀態為「死亡」但未填死亡日 / When 我嘗試儲存
// Then 顯示驗證錯誤，儲存被阻擋（重新整理後仍是存活）
test('沒填死亡日就儲存會被擋下', async ({ page }) => {
  await openCreature(page, '藍倒吊')

  await page.getByTestId('status-option').filter({ hasText: '死亡' }).click()
  await page.getByTestId('creature-save').click()

  await expect(page.getByTestId('creature-error')).toContainText('死亡日')

  await page.reload()
  await expect(page.getByTestId('status-option').first()).toHaveAttribute('aria-pressed', 'true')
})

// Given 我填入的死亡日早於入缸日 / When 我嘗試儲存 / Then 顯示日期先後順序的驗證錯誤
test('死亡日早於入缸日會被擋下', async ({ page }) => {
  await openCreature(page, '藍倒吊')

  await page.getByTestId('status-option').filter({ hasText: '死亡' }).click()
  await page.locator('input[name="diedOn"]').fill('2000-01-01')
  await page.getByTestId('creature-save').click()

  await expect(page.getByTestId('creature-error')).toContainText('死亡日不能早於入缸日')
})

// Given 某生物目前狀態為死亡 / When 我改回「存活」並儲存
// Then 死亡相關資料被清除，返回列表後該生物顯示為存活樣式
// 再把死亡記錄填回去 / Then 列表回到「跳缸 · MM / DD」的死亡樣式
//
// 這是唯一會寫入的測試，改完會把 seed 的六線龍還原成原本的死亡記錄。
test('切換狀態並儲存後，列表的樣式跟著改變', async ({ page }) => {
  await openCreature(page, '六線龍')

  const detailUrl = page.url()

  // 先記下原本的死亡記錄，結束前要原樣填回去
  const diedOn = await page.locator('input[name="diedOn"]').inputValue()
  const observedSickOn = await page.locator('input[name="observedSickOn"]').inputValue()
  const deathNote = await page.locator('textarea[name="deathNote"]').inputValue()

  // 死亡 → 存活
  await page.getByTestId('status-option').filter({ hasText: '存活' }).click()
  await page.getByTestId('creature-save').click()

  await expect(page.getByTestId('death-record')).toHaveCount(0)
  await expect(page.getByTestId('status-option').first()).toHaveAttribute('aria-pressed', 'true')

  await page.goto('/creatures')
  const row = page.getByTestId('creature-row').filter({ hasText: '六線龍' }).first()
  await expect(row).toHaveAttribute('data-status', 'ALIVE')
  await expect(row.getByTestId('creature-subtitle')).toContainText('入缸')

  // 存活 → 死亡（把 seed 的內容原樣填回去）
  await page.goto(detailUrl)
  await page.getByTestId('status-option').filter({ hasText: '死亡' }).click()
  await page.locator('input[name="diedOn"]').fill(diedOn)
  await page.locator('input[name="observedSickOn"]').fill(observedSickOn)
  await page.locator('textarea[name="deathNote"]').fill(deathNote)
  await page.getByTestId('death-cause-option').filter({ hasText: '跳缸' }).click()
  await page.getByTestId('creature-save').click()

  await expect(page.getByTestId('creature-error')).toHaveCount(0)
  await expect(page.getByTestId('death-record')).toBeVisible()

  await page.goto('/creatures')
  const restored = page.getByTestId('creature-row').filter({ hasText: '六線龍' }).first()
  await expect(restored).toHaveAttribute('data-status', 'DEAD')
  await expect(restored.getByTestId('creature-subtitle')).toContainText(/跳缸 · \d{2} \/ \d{2}/)
})
