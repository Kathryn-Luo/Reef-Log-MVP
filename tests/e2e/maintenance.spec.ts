import type { Locator, Page } from '@playwright/test'
import { expect, test } from './support/guestSession'

// 保養提醒（issue #125 ＝ #15 的畫面那一半，screen-7）。
//
// 每個 test 開場先以訪客身分登入，各自拿到一份模板示範資料的複本（issue #80）——
// 這一支會勾選 / 取消保養任務，寫在自己的沙盒裡，不會被別的 test 看到。
//
// E2E 不在 TDD Develop 的 job 內執行，跑在 Vercel preview URL 上（#23）。
// 「勾一下 → 真的寫進資料庫 → 重新整理仍然是已完成」這條路徑要有資料庫才驗得到，
// 所以主線留在這裡；分區、徽章與排版的細節由 unit 測試覆蓋。
//
// ⚠ 不要假設示範資料剛好落在哪一區。`prisma/seed.ts` 的五個任務各自「幾天前做過」是
// `pnpm db:seed` 執行當下算的，訪客沙盒又照原值整棵複製（server/utils/guestSandbox.ts
// 不重算時間），所以它會隨著 preview 上次 seed 的日子一天天變舊：剛 seed 完「今天該做」
// 只有已完成的「餵食」，過幾天每天一次的「餵食」與每 7 天的那兩個會陸續逾期，再過一個月
// 連「即將到期」都可能空掉。**兩種樣子都是對的**，所以這裡一律先看畫面與 API 的現況再挑
// 對象，挑不到就 `test.skip()` 並說明原因。寫死任何一種都會在某一天紅掉——這一課是
// PR #138 踩出來的（water-log.spec.ts 有一條寫死「七天前」，同一份程式碼隔天全紅）。

interface TaskFact {
  id: string
  name: string
  lastCompletion: { completedOn: string } | null
}

/** 使用者當地的今天。runner 與瀏覽器跑在同一台機器上，兩邊的牆上時間是同一個 */
function today(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * 這個沙盒裡的保養任務與各自最後一筆完成紀錄——也就是畫面拿到的那份「事實」。
 *
 * 分區、徽章與到期日都是畫面用這份資料算出來的（#shared/utils/maintenance），
 * 所以拿它來斷言「有沒有真的寫進去」，而不是反過來要求資料長成某個樣子。
 */
async function maintenanceTasks(page: Page): Promise<TaskFact[]> {
  const { request } = page.context()
  const { tanks } = await (await request.get('/api/tanks')).json() as { tanks: { id: string }[] }

  expect(tanks.length, '訪客沙盒裡沒有任何缸——preview 的資料庫可能沒跑過 pnpm db:seed').toBeGreaterThan(0)

  const { tasks } = await (await request.get(`/api/tanks/${tanks[0]!.id}/maintenance`)).json() as { tasks: TaskFact[] }

  return tasks
}

/**
 * 等到資料到齊、畫面切到「有任務」那一支為止。
 *
 * 這裡刻意等**正面的訊號**（「今天該做」那一區出現），不是等載入樣態消失。#84 之後是
 * SPA，`page.goto()` 回來時整個 app 都還沒 mount，`maintenance-loading` 的筆數在
 * 「還沒開始載入」與「載入完了」兩個時刻同樣都是 0——拿它當閘門的話，這個等待在
 * hydration 之前就先通過了，等於沒等（#129）。
 */
async function expectLoaded(page: Page) {
  await expect(page.getByTestId('today-section')).toBeVisible()
}

const rowById = (page: Page, taskId: string) => page.locator(`[data-testid="today-row"][data-task-id="${taskId}"]`)

const checkbox = (row: Locator) => row.getByTestId('task-checkbox')

/** 「今天該做」區裡第一列處於某個勾選狀態的列；一列都沒有時回 null */
async function firstRowChecked(page: Page, checked: boolean): Promise<Locator | null> {
  const rows = page.getByTestId('today-row')
    .filter({ has: page.locator(`[data-testid="task-checkbox"][aria-checked="${checked}"]`) })

  return await rows.count() ? rows.first() : null
}

// Given 我進入「保養」頁 / When 畫面載入
// Then 頁首顯示「保養提醒」與副標「<缸名> · N 月 N 日 週X」
// And  畫面分為「今天該做」與「即將到期」兩區
test('頁首與兩個區塊', async ({ page }) => {
  await page.goto('/maintenance')

  await expectLoaded(page)

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('保養提醒')
  // 缸名之後是使用者當地的今天。日期本身每天都不一樣，所以認的是格式
  await expect(page.getByTestId('maintenance-subtitle')).toHaveText(/^主缸 · \d{1,2} 月 \d{1,2} 日 週[日一二三四五六]$/)
  await expect(page.getByTestId('today-section')).toContainText('今天該做')
  await expect(page.getByTestId('upcoming-section')).toContainText('即將到期')

  // 4-1：＋ 新增按鈕連向的表單屬於 #17，那一頁還不存在，這一輪刻意不渲染
  await expect(page.getByTestId('maintenance-add')).toHaveCount(0)
})

// Given 某個任務在今天該做清單中且未完成 / When 我點擊它的 checkbox
// Then 新增一筆今天的完成紀錄，該列即時轉為已完成樣式 / And 徽章數字減一
test('勾選之後重新整理，那一列仍然是已完成', async ({ page }) => {
  await page.goto('/maintenance')

  await expectLoaded(page)

  const row = await firstRowChecked(page, false)

  test.skip(!row, '這個沙盒的「今天該做」區沒有未完成的任務；示範資料會隨上次 seed 的日子漂移，這是允許的樣子之一')

  const taskId = (await row!.getAttribute('data-task-id'))!
  const dueBefore = Number(await page.getByTestId('today-badge').textContent())

  await checkbox(row!).click()

  await expect(checkbox(rowById(page, taskId))).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('today-badge')).toHaveText(String(dueBefore - 1))
  // 樂觀更新失敗時會回捲並在那一列旁邊講一句，所以這裡順帶確認沒有回捲
  await expect(rowById(page, taskId).getByTestId('task-error')).toHaveCount(0)

  // ⚠ 先等 server 真的收下，再 reload。
  //
  // 上面那三條看的全是**樂觀更新**：畫面在 POST 送出去之前就已經長成已完成的樣子，
  // 所以它們一條都擋不住「請求還在路上」。直接 reload 會把還在路上的 POST 一起取消，
  // 那一筆就永遠沒寫進去，reload 之後自然還是未勾選。
  // 實際踩過：run 31157924044 重試才過，run 31160034319 三次重試全紅。
  await expect.poll(
    async () => (await maintenanceTasks(page)).find(task => task.id === taskId)?.lastCompletion?.completedOn,
    { message: '勾選要真的寫進資料庫，不能只有畫面變了' },
  ).toBe(today())

  // 真的寫進資料庫了：重新整理之後仍然是已完成
  await page.reload()
  await expectLoaded(page)
  await expect(checkbox(rowById(page, taskId))).toHaveAttribute('aria-checked', 'true')
})

// Given 某個任務今天已完成 / When 我再次點擊它的 checkbox（取消勾選）
// Then 刪除今天那一筆完成紀錄，該列回到未完成樣式
test('取消勾選之後重新整理，那一列仍然是未完成', async ({ page }) => {
  await page.goto('/maintenance')

  await expectLoaded(page)

  const row = await firstRowChecked(page, true)

  test.skip(!row, '這個沙盒今天沒有已完成的任務；示範資料會隨上次 seed 的日子漂移，這是允許的樣子之一')

  const taskId = (await row!.getAttribute('data-task-id'))!
  const dueBefore = Number(await page.getByTestId('today-badge').textContent())

  await checkbox(row!).click()

  await expect(checkbox(rowById(page, taskId))).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByTestId('today-badge')).toHaveText(String(dueBefore + 1))

  // 與上面同一個理由：這兩條看的是樂觀更新，DELETE 可能還沒送到就被 reload 取消
  await expect.poll(
    async () => (await maintenanceTasks(page)).find(task => task.id === taskId)?.lastCompletion?.completedOn,
    { message: '取消勾選要真的把那一筆刪掉，不能只有畫面變了' },
  ).not.toBe(today())

  await page.reload()
  await expectLoaded(page)
  await expect(checkbox(rowById(page, taskId))).toHaveAttribute('aria-checked', 'false')
})

// Given 今天已完成的任務 / Then 它仍留在「今天該做」區，不因為做完了就跳到「即將到期」
test('今天已完成的任務留在「今天該做」區', async ({ page }) => {
  await page.goto('/maintenance')

  await expectLoaded(page)

  const done = (await maintenanceTasks(page)).filter(task => task.lastCompletion?.completedOn === today())

  test.skip(!done.length, '這個沙盒今天沒有已完成的任務；示範資料會隨上次 seed 的日子漂移')

  for (const task of done) {
    await expect(rowById(page, task.id)).toHaveCount(1)
    await expect(page.locator(`[data-testid="upcoming-row"][data-task-id="${task.id}"]`)).toHaveCount(0)
    await expect(rowById(page, task.id).getByTestId('task-subtitle')).toContainText('已完成')
  }
})

// Given 尚未到期的任務 / Then 它們出現在「即將到期」區，每列有日 / 月方塊與「N 天後」
// And  這一區沒有 checkbox（提前打勾會讓下次到期日整條往後推）
test('即將到期的每一列有日 / 月方塊與「N 天後」，且沒有 checkbox', async ({ page }) => {
  await page.goto('/maintenance')

  await expectLoaded(page)

  const rows = page.getByTestId('upcoming-row')

  test.skip(!await rows.count(), '這個沙盒 30 天內沒有即將到期的任務；示範資料會隨上次 seed 的日子漂移')

  const first = rows.first()

  await expect(first.getByTestId('due-day')).toHaveText(/^\d{2}$/)
  await expect(first.getByTestId('due-month')).toHaveText(/^\d{1,2}月$/)
  await expect(first.getByTestId('due-in')).toHaveText(/^\d+ 天後$/)
  await expect(page.getByTestId('upcoming-section').getByTestId('task-checkbox')).toHaveCount(0)
})
