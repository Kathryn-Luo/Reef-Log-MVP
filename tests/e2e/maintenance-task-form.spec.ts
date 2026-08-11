import { expect, test } from './support/guestSession'

const DAY_MS = 24 * 60 * 60 * 1000

function localDateOffset(days: number): string {
  const at = new Date(Date.now() + days * DAY_MS)
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

async function openMaintenance(page: import('@playwright/test').Page) {
  await page.goto('/maintenance')
  await expect(page.getByTestId('today-section')).toBeVisible()
}

test('從保養頁建立自訂 60 天任務後，清單看得到', async ({ page }) => {
  const name = `E2E 清潔蛋白機 ${Date.now()}`

  await openMaintenance(page)
  await page.getByTestId('maintenance-add').click()
  await expect(page).toHaveURL(/\/maintenance\/tasks\/new$/)
  await expect(page.getByTestId('maintenance-task-form')).toBeVisible()

  await page.locator('[name="name"]').fill(name)
  await page.getByTestId('maintenance-interval-option').filter({ hasText: '每兩個月' }).click()
  // 起算日往前 60 天，讓新任務今天到期並落在既有的 30 天顯示窗口內。
  await page.locator('[name="startOn"]').fill(localDateOffset(-60))
  await page.getByTestId('maintenance-task-submit').click()

  await expect(page).toHaveURL(/\/maintenance$/)
  const row = page.getByTestId('today-row').filter({ hasText: name })
  await expect(row).toBeVisible()
  await expect(row.getByTestId('task-subtitle')).toContainText('每 60 天')
})

test('從任務列編輯名稱與週期後，清單同步更新', async ({ page }) => {
  const renamed = `E2E 每日換水 ${Date.now()}`

  await openMaintenance(page)
  await page.getByRole('link', { name: '編輯 換水 10%' }).click()
  await expect(page).toHaveURL(/\/maintenance\/tasks\/[^/]+\/edit$/)

  await page.locator('[name="name"]').fill(renamed)
  await page.getByTestId('maintenance-interval-option').filter({ hasText: '每天' }).click()
  await page.getByTestId('maintenance-task-submit').click()

  await expect(page).toHaveURL(/\/maintenance$/)
  const updated = page.getByTestId('today-row').filter({ hasText: renamed })
  await expect(updated).toBeVisible()
  await expect(updated.getByTestId('task-subtitle')).toContainText('每天')
  await expect(page.getByTestId('task-name').filter({ hasText: /^換水 10%$/ })).toHaveCount(0)
})

test('停用任務後不再顯示，既有其他任務仍保留', async ({ page }) => {
  await openMaintenance(page)

  await page.getByRole('link', { name: '編輯 換水 10%' }).click()
  await expect(page.getByTestId('maintenance-task-form')).toBeVisible()

  await page.getByTestId('maintenance-task-active').click()
  await expect(page.getByTestId('maintenance-task-active')).toHaveAttribute('aria-checked', 'false')
  await page.getByTestId('maintenance-task-submit').click()

  await expect(page).toHaveURL(/\/maintenance$/)
  await expect(page.getByTestId('task-name').filter({ hasText: /^換水 10%$/ })).toHaveCount(0)
  await expect(page.getByTestId('today-row').first()).toBeVisible()
})
