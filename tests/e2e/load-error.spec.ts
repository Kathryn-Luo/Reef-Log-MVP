import { expect, test } from './support/guestSession'

// 取資料失敗時畫面要說「載入失敗」，不是空狀態（issue #132）。
//
// 每個 test 開場先以訪客身分登入，各自拿到一份模板示範資料的複本（issue #80）——
// 這一支需要「本來有資料」當前提，否則「失敗」與「真的沒有」分不出來。
//
// ── 為什麼用瀏覽器端攔截，而不是真的弄出一個 500 ──
//
// preview 上要造出真正的 500 得把 Vercel function 或 Neon 弄掛，那既做不到也不該做。
// `page.route` 攔的是頁面實際打出去的那一支 API，回的是貨真價實的 500 回應，
// 所以頁面走的是與真的碰上 500 時同一條分支。攔截點在瀏覽器與網路之間，
// 不需要動到 server 端任何程式碼。
//
// unit 那一層（tests/unit/pages/*.test.ts）已經驗得到三頁的分支選擇；
// 這裡補的是 unit 驗不到的一半：SPA 首屏真的走一次網路、真的按下去、真的重新取回。

/** 說不出原因的失敗——與 server 掛掉時瀏覽器收到的東西同一個形狀 */
const SERVER_ERROR = {
  status: 500,
  contentType: 'application/json',
  body: JSON.stringify({ statusCode: 500, statusMessage: 'Internal Server Error' }),
}

// Given 我有一個缸 / When 我進入首頁，而 API 回 500
// Then 畫面顯示「載入失敗」與重試的入口，不是空狀態
test('首頁的 API 回 500 時顯示載入失敗，不是「還沒有任何缸」', async ({ page }) => {
  await page.route('**/api/tanks', route => route.fulfill(SERVER_ERROR))

  await page.goto('/')

  await expect(page.getByTestId('load-error')).toContainText('載入失敗')
  await expect(page.getByTestId('load-error-retry')).toBeVisible()
  await expect(page.getByTestId('tank-empty')).toHaveCount(0)
})

// And 我不會被引導去建立第二個缸
test('首頁載入失敗時沒有任何前往建立缸的入口', async ({ page }) => {
  await page.route('**/api/tanks', route => route.fulfill(SERVER_ERROR))

  await page.goto('/')

  await expect(page.getByTestId('load-error')).toBeVisible()
  await expect(page.getByTestId('tank-empty-action')).toHaveCount(0)
  await expect(page.locator('a[href="/tanks/new"]')).toHaveCount(0)
})

// Given 畫面顯示載入失敗 / When 我點「重試」
// Then 重新發出同一個請求，成功後正常顯示
test('首頁點「重試」後重新取回資料，畫面回到正常', async ({ page }) => {
  let failing = true

  await page.route('**/api/tanks', async (route) => {
    if (failing) {
      await route.fulfill(SERVER_ERROR)
      return
    }

    await route.continue()
  })

  await page.goto('/')
  await expect(page.getByTestId('load-error')).toBeVisible()

  failing = false
  await page.getByTestId('load-error-retry').click()

  await expect(page.getByTestId('load-error')).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('主缸 · 4 尺')
})

// Given 我真的沒有任何缸——這一半不能被上面那一半吃掉。
// 訪客沙盒裡本來就有「主缸」，所以改為確認「有資料時不會誤報載入失敗」。
test('沒有攔截時首頁正常顯示，不會誤報載入失敗', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('主缸 · 4 尺')
  await expect(page.getByTestId('load-error')).toHaveCount(0)
})

test('生物庫存的 API 回 500 時顯示載入失敗，不是空狀態', async ({ page }) => {
  await page.route('**/api/tanks', route => route.fulfill(SERVER_ERROR))

  await page.goto('/creatures')

  await expect(page.getByTestId('load-error')).toContainText('載入失敗')
  await expect(page.getByTestId('tank-empty')).toHaveCount(0)
  await expect(page.getByTestId('creature-empty')).toHaveCount(0)
})

test('生物庫存點「重試」後重新取回資料，畫面回到正常', async ({ page }) => {
  let failing = true

  await page.route('**/api/tanks/*/creatures', async (route) => {
    if (failing) {
      await route.fulfill(SERVER_ERROR)
      return
    }

    await route.continue()
  })

  await page.goto('/creatures')
  await expect(page.getByTestId('load-error')).toBeVisible()

  failing = false
  await page.getByTestId('load-error-retry').click()

  await expect(page.getByTestId('load-error')).toHaveCount(0)
  await expect(page.getByTestId('inventory-subtitle')).toHaveText('主缸 · 12 隻')
})

// 生物詳情原本把所有失敗吞成 null，於是 500 也被講成「找不到這隻生物」。
// 500 → 載入失敗；404 → 找不到。兩句話必須分得出來。
test('生物詳情的 API 回 500 時顯示載入失敗，不是「找不到這隻生物」', async ({ page }) => {
  // 先正常進到列表，取一個真的存在的 id——攔截要等拿到 id 之後才掛上
  await page.goto('/creatures')

  const href = await page.getByTestId('creature-row').first().locator('a').getAttribute('href')

  expect(href).toBeTruthy()

  await page.route('**/api/creatures/*', route => route.fulfill(SERVER_ERROR))
  await page.goto(href!)

  await expect(page.getByTestId('load-error')).toContainText('載入失敗')
  await expect(page.getByTestId('creature-missing')).toHaveCount(0)
  // 失敗的是這一頁的資料，不是整個 App——返回列表的入口要留著
  await expect(page.getByTestId('creature-back')).toBeVisible()
})

test('生物詳情的 API 回 404 時仍然顯示「找不到這隻生物」', async ({ page }) => {
  await page.goto('/creatures/does-not-exist')

  await expect(page.getByTestId('creature-missing')).toBeVisible()
  await expect(page.getByTestId('load-error')).toHaveCount(0)
})
