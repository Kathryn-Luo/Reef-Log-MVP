import { expect, test } from '@playwright/test'

test('home page loads and shows the ReefLog heading', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'ReefLog' })).toBeVisible()
})
