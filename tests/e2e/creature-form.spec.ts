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

// issue #159
// Given 我尚未建立任何生物 / When 我在學名欄輸入俗名
// Then  顯示符合內建物種清單的建議，且選取後帶入學名與細分類
test('用俗名搜尋物種建議，選取後帶入學名與細分類並成功建立', async ({ page }) => {
  const name = `E2E 建議生物 ${Date.now()}`

  await page.goto('/creatures/new')
  await expect(page.getByTestId('creature-profile-form')).toBeVisible()

  await page.locator('[name="name"]').fill(name)
  await page.getByTestId('creature-category-option').filter({ hasText: '魚' }).click()
  await page.locator('[name="addedOn"]').fill(new Date().toISOString().slice(0, 10))

  await page.locator('[name="scientificName"]').fill('火焰')
  await page.getByTestId('creature-suggestion').filter({ hasText: 'Centropyge loriculus' }).first().click()

  await expect(page.locator('[name="scientificName"]')).toHaveValue('Centropyge loriculus')
  await expect(page.locator('[name="subCategory"]')).toHaveValue('神仙')

  await page.getByTestId('creature-profile-submit').click()

  await expect(page).toHaveURL(/\/creatures\/[^/]+$/)
  await expect(page.getByTestId('creature-name')).toHaveText(name)
  await expect(page.getByTestId('creature-taxonomy')).toContainText('神仙')
})

// Given 我要輸入建議清單中不存在的值 / When 我直接完成輸入並儲存
// Then  表單接受該自由文字
test('清單外的學名與細分類仍可自由輸入並儲存', async ({ page }) => {
  const stamp = Date.now()
  const name = `E2E 自由文字 ${stamp}`
  const scientificName = `Ignotus piscis ${stamp}`

  await page.goto('/creatures/new')
  await expect(page.getByTestId('creature-profile-form')).toBeVisible()

  await page.locator('[name="name"]').fill(name)
  await page.getByTestId('creature-category-option').filter({ hasText: '其他' }).click()
  await page.locator('[name="addedOn"]').fill(new Date().toISOString().slice(0, 10))
  await page.locator('[name="scientificName"]').fill(scientificName)
  await page.locator('[name="subCategory"]').fill('我自己分的類')

  await page.getByTestId('creature-profile-submit').click()

  await expect(page).toHaveURL(/\/creatures\/[^/]+$/)
  await expect(page.getByTestId('creature-name')).toHaveText(name)
  await expect(page.getByTestId('creature-taxonomy')).toContainText('我自己分的類')

  // 剛剛存下去的清單外學名，回到表單就成為自己的歷史建議
  await page.getByTestId('creature-edit').click()
  await expect(page.getByTestId('creature-profile-form')).toBeVisible()
  await page.locator('[name="scientificName"]').fill(`Ignotus piscis ${stamp}`.slice(0, 14))
  await expect(
    page.getByTestId('creature-suggestion').filter({ hasText: scientificName }).first(),
  ).toBeVisible()
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
  await expect(page.getByTestId('creature-name').filter({ hasText: /^藍倒吊$/ })).toHaveCount(0)
})
