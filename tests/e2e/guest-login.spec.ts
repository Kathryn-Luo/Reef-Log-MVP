import { expect, test } from '@playwright/test'
import type { BrowserContext } from '@playwright/test'
import { GUEST_LOGIN_NAV_TIMEOUT_MS } from './support/guestSession'

// 訪客登入（issue #66）。E2E 不在 TDD Develop 的 job 內執行，跑在 Vercel preview URL 上。
//
// 這條路徑是 preview 與 E2E 唯一走得通的登入方式：Google 的 Authorized redirect URI
// 不支援萬用字元，而 Vercel 每個 branch 一個動態網址（Epic #47 的硬約束）。
//
// 前提：preview 的資料庫已跑過 `prisma/seed.ts`（模板使用者名下有「主缸」等示範資料）。
// 模板還沒 seed 時訪客仍進得去，只是沙盒是空的——那時第一條會落在首頁的空狀態上。

/** 該 context 目前看得到的缸 id（訪客的資料歸屬只有從 API 這一層看得出來） */
async function tankIds(context: BrowserContext): Promise<string[]> {
  const response = await context.request.get('/api/tanks')
  const { tanks } = await response.json() as { tanks: Array<{ id: string }> }

  return tanks.map(tank => tank.id)
}

// Given 我從未以訪客身分進站 / When 我按下「以訪客身分瀏覽」
// Then 我拿到一份自己的示範資料
test('按下「以訪客身分瀏覽」就進得了首頁，看得到自己的示範資料', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('login-action-guest').click()

  // 這一句等的是訪客登入那一次導航（preview 上 9.4～14.8 秒），預算另計——
  // 本檔每一次登入都用同一個常數，理由見 support/guestSession.ts（#111）。
  // 下一句就回到全域的 15 秒：那時人已經在首頁，等的只是畫面。
  await expect(page).toHaveURL('/', { timeout: GUEST_LOGIN_NAV_TIMEOUT_MS })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('主缸 · 4 尺')
  await expect(page.getByTestId('tank-subtitle')).toHaveText('SPS MIXED · 420L')
})

// Given 我已有訪客 session / When 我再次進站
// Then 沿用同一位訪客 User，不會再建一個沙盒
test('再次進站沿用同一個沙盒，不會多長出一份示範資料', async ({ page, context }) => {
  await page.goto('/login')
  await page.getByTestId('login-action-guest').click()
  await expect(page).toHaveURL('/', { timeout: GUEST_LOGIN_NAV_TIMEOUT_MS })

  const before = await tankIds(context)

  // 「再次進站」最嚴格的形式是連建立沙盒的那條路徑都再走一遍，沙盒仍該原封不動。
  //
  // 這一段不能經過登入頁的 UI（issue #87）：#67 之後 route middleware 會把已登入的人
  // 從 /login 帶回首頁，那顆「以訪客身分瀏覽」按鈕永遠不會出現，click() 只能等到超時。
  // 所以直接打那顆按鈕指向的終點 /auth/guest——按鈕本身由上面第一條 test 顧著，
  // 這條要驗的「建立沙盒那條路徑再跑一次也不會多長出東西」原封不動保留。
  //
  // context.request 與瀏覽器共用同一份 cookie，伺服器看到的仍是「已經有身分」的那一位。
  const again = await context.request.get('/auth/guest')

  // 已經有身分時沿用現有 session、照樣導回首頁。這一條不是順便驗的：登入失敗時
  // 這支路由會改導向 /login 而不留下任何痕跡，少了它，一次失敗的訪客登入會因為
  // 「沙盒沒變」而被下面那句判成通過。
  expect(again.ok()).toBe(true)
  expect(new URL(again.url()).pathname).toBe('/')

  expect(await tankIds(context)).toEqual(before)
})

// Given 訪客 A 與訪客 B 同時以訪客身分瀏覽
// Then A 與 B 各自看到自己的資料
test('兩位訪客拿到各自的沙盒', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])

  const ids = await Promise.all(contexts.map(async (context) => {
    const page = await context.newPage()

    await page.goto('/login')
    await page.getByTestId('login-action-guest').click()
    await expect(page).toHaveURL('/', { timeout: GUEST_LOGIN_NAV_TIMEOUT_MS })

    return tankIds(context)
  }))

  const [a, b] = ids

  expect(a).not.toHaveLength(0)
  expect(a).toHaveLength(b!.length)
  // 同一份模板複製出來的兩份，內容一樣但沒有任何一列是共用的
  expect(a!.filter(id => b!.includes(id))).toEqual([])

  await Promise.all(contexts.map(context => context.close()))
})

// Given 訪客 A 修改或刪除了自己沙盒裡的示範資料 / When 訪客 C 之後以訪客身分進站
// Then C 拿到的是乾淨的示範資料，不受 A 的操作影響
test('訪客改動自己的沙盒之後，下一位訪客拿到的仍是乾淨的示範資料', async ({ browser }) => {
  const first = await browser.newContext()
  const page = await first.newPage()

  await page.goto('/login')
  await page.getByTestId('login-action-guest').click()
  await expect(page).toHaveURL('/', { timeout: GUEST_LOGIN_NAV_TIMEOUT_MS })

  // 訪客可寫，且寫入 API 不判斷 provider（Story ⑤）——這一筆就是「A 弄髒自己的沙盒」
  const created = await first.request.post('/api/tanks', {
    data: { name: '訪客自己加的缸', sizeSpec: '1 尺' },
  })

  expect(created.ok()).toBe(true)

  const dirty = await tankIds(first)

  const second = await browser.newContext()
  const nextPage = await second.newPage()

  await nextPage.goto('/login')
  await nextPage.getByTestId('login-action-guest').click()
  await expect(nextPage).toHaveURL('/', { timeout: GUEST_LOGIN_NAV_TIMEOUT_MS })

  const clean = await tankIds(second)

  // A 多出來的那個缸不在 C 的沙盒裡，而且 C 的缸數就是模板的缸數
  expect(clean.length).toBe(dirty.length - 1)
  expect(clean.filter(id => dirty.includes(id))).toEqual([])
  await expect(nextPage.getByRole('heading', { level: 1 })).toHaveText('主缸 · 4 尺')

  await Promise.all([first.close(), second.close()])
})
