import { expect, test } from './support/guestSession'

async function openCreature(page: import('@playwright/test').Page, name: string) {
  await page.goto('/creatures')
  await page.getByTestId('creature-row').filter({ hasText: name }).first().getByRole('link').click()
  await expect(page.getByTestId('creature-taxonomy')).toBeVisible()
}

test('從庫存新增生物後，首頁與庫存都看得到', async ({ page }) => {
  const name = `E2E 生物 ${Date.now()}`

  await page.goto('/creatures')
  await page.getByTestId('creature-add').click()
  await expect(page).toHaveURL(/\/creatures\/new$/)

  await page.locator('[name="name"]').fill(name)
  await page.getByTestId('creature-category-option').filter({ hasText: '魚' }).click()
  await page.locator('[name="addedOn"]').fill(new Date().toISOString().slice(0, 10))
  await page.locator('[name="price"]').fill('350.50')
  await page.getByTestId('creature-profile-submit').click()

  await expect(page).toHaveURL(/\/creatures\/[^/]+$/)
  await expect(page.getByTestId('creature-name')).toHaveText(name)

  await page.goto('/creatures')
  await expect(page.getByTestId('creature-name').filter({ hasText: name })).toBeVisible()

  await page.goto('/')
  await expect(page.getByText(name, { exact: true })).toBeVisible()
})

test('從詳情頁編輯俗名後，詳情與庫存同步更新', async ({ page }) => {
  const renamed = `E2E 藍倒吊 ${Date.now()}`

  await openCreature(page, '藍倒吊')
  await page.getByTestId('creature-edit').click()
  await expect(page.getByTestId('creature-profile-form')).toBeVisible()

  await page.locator('[name="name"]').fill(renamed)
  await page.getByTestId('creature-profile-submit').click()

  await expect(page).toHaveURL(/\/creatures\/[^/]+$/)
  await expect(page.getByTestId('creature-name')).toHaveText(renamed)

  await page.goto('/creatures')
  await expect(page.getByTestId('creature-name').filter({ hasText: renamed })).toBeVisible()
  await expect(page.getByTestId('creature-name').filter({ hasText: '藍倒吊' })).toHaveCount(0)
})
