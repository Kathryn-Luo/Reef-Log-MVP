import { expect, test } from './support/guestSession'

// 每個 test 開場先以訪客身分登入，各自拿到一份示範資料（issue #80）。
// 未登入時這幾頁會被帶去 /login（#67），底部 tab 列根本不會出現。

const TABS = [
  { label: '首頁', path: '/' },
  { label: '記錄', path: '/log' },
  { label: '趨勢', path: '/trends' },
  { label: '生物', path: '/creatures' },
  { label: '保養', path: '/maintenance' },
]

// Given 我開啟 App / When 畫面載入完成
// Then 底部固定顯示五個 tab：首頁、記錄、趨勢、生物、保養，且「首頁」為選中狀態
test('開啟 App 時底部顯示五個 tab，首頁為選中狀態', async ({ page }) => {
  await page.goto('/')

  const tabBar = page.getByRole('navigation', { name: '主要導覽' })
  await expect(tabBar).toBeVisible()
  await expect(tabBar.getByRole('link')).toHaveText(TABS.map(tab => tab.label))
  await expect(tabBar.getByRole('link', { name: '首頁' })).toHaveAttribute('aria-current', 'page')
})

// Given 我正在任一個 tab 頁面 / When 我點擊底部另一個 tab
// Then 路由切換到該頁面，且該 tab 變為選中狀態
test('點擊各 tab 後 URL 與選中狀態都跟著切換', async ({ page }) => {
  await page.goto('/')
  const tabBar = page.getByRole('navigation', { name: '主要導覽' })

  for (const tab of TABS.slice(1)) {
    await tabBar.getByRole('link', { name: tab.label }).click()
    await expect(page).toHaveURL(tab.path)
    await expect(tabBar.getByRole('link', { name: tab.label })).toHaveAttribute('aria-current', 'page')
    await expect(tabBar.getByRole('link', { name: '首頁' })).not.toHaveAttribute('aria-current', 'page')
  }
})

// Given 我正在「生物詳情」這類子頁面（畫面上方為 ← 返回）/ When 畫面呈現
// Then 底部 tab 列仍然存在，且「生物」tab 維持選中狀態
test('生物子頁面仍保留 tab 列，且「生物」維持選中', async ({ page }) => {
  await page.goto('/creatures/demo-creature-id')

  const tabBar = page.getByRole('navigation', { name: '主要導覽' })
  await expect(tabBar).toBeVisible()
  await expect(tabBar.getByRole('link', { name: '生物' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByLabel('返回生物列表')).toBeVisible()
})

// Given 我在行動裝置上瀏覽 / When 任一頁面渲染
// Then 全站套用深色主題，底部 tab 列位於安全區域之上
test('全站深色主題，tab 列固定在底部安全區域之上', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('html')).toHaveClass(/dark/)

  const tabBar = page.getByRole('navigation', { name: '主要導覽' })
  await expect(tabBar).toHaveCSS('position', 'fixed')

  const viewport = page.viewportSize()
  const box = await tabBar.boundingBox()
  expect(box).not.toBeNull()
  expect(Math.round(box!.y + box!.height)).toBe(viewport!.height)
})
