import type { Page } from '@playwright/test'
import { expect, test } from './support/guestSession'

// 訪客走完 Profile 這一趟（issue #169）。E2E 不在 TDD Develop 的 job 內執行，
// 跑在 Vercel preview URL 上。
//
// 每個 test 開場先以訪客身分登入，各自拿到一份模板示範資料的複本（issue #80）——
// 訪客也是 preview 上唯一登得進去的身分：Google 的 Authorized redirect URI 不支援
// 萬用字元，而 Vercel 每個分支一個動態網址（CLAUDE.md、Epic #47 的硬約束）。
//
// ⚠ 這一支能驗的東西比 Epic #160 的畫面少很多，而且是刻意的。
//
// Epic #160（2026-08-12）定了兩件事：**訪客不可改名**（#171）、**訪客不得上傳頭像**
// （#166）。與「preview 上只登得進訪客」湊起來，改名成功、上傳、移除、前端縮圖
// 在這裡一條都跑不到。那些由各自的 unit test 覆蓋（Prisma 與 Blob store 都是替身），
// 前端縮圖的真實瀏覽器驗證見 #176——那要用真的 Chromium，而不是真的部署。
//
// **不要**為了讓這一支「測到更多東西」而放寬 #166 / #171 的 403，也不要在 E2E 裡
// 直接改資料庫或偽造 session。那兩個 403 是本輪刻意的決定，不是待補的缺口。

/** 最小的合法 PNG（1×1 透明）。訪客被擋的理由必須是身分，所以檔案本身要無可挑剔 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

interface ProfileBody {
  displayName: string | null
  email: string | null
  avatarUrl: string | null
  avatarSource: string
}

/**
 * 開 /profile，並等到帳號資訊**真的畫出來**。
 *
 * 等的是正面訊號（`profile-account` 只存在於成功態；載入中是 `profile-loading`、
 * 載入失敗是 LoadErrorState）。SPA 下「某個東西不存在」在還沒 mount 的那一拍同樣成立，
 * 底下每一句 `toHaveCount(0)` 都得排在這一句之後才有意義（#129 / #146 的教訓）。
 */
async function openProfile(page: Page) {
  await page.goto('/profile')

  await expect(page.getByTestId('profile-account')).toBeVisible()
}

// Given 我以訪客身分登入並停在首頁
// When  我點擊右上角的 Profile icon
// Then  進入 /profile，並看到名稱「訪客」、訪客登入方式與加入日期，且沒有 Email 列
test('從首頁右上角的 Profile 入口進得了個人資料頁，看得到帳號資訊', async ({ page }) => {
  await page.goto('/')

  // 頁首自己畫出來了才點得到那個入口——fixture 等的是 API 那一側的示範資料
  await expect(page.getByTestId('home-sticky-header')).toBeVisible()

  await page.getByTestId('tank-header-profile').click()

  await expect(page).toHaveURL('/profile')
  // 正面訊號先行：底下那句「沒有 Email 列」在頁面還沒開始畫時同樣成立
  await expect(page.getByTestId('profile-account')).toBeVisible()

  await expect(page.getByTestId('profile-display-name')).toHaveText('訪客')
  await expect(page.getByTestId('profile-providers')).toContainText('訪客')
  // 加入日期是 Intl 的 zh-TW 兩位數格式（2026/08/13）。這一位訪客剛剛才建立，
  // 但不釘死在「今天」——server 用的是 UTC，跨日那一刻會變成一條偶發紅
  await expect(page.getByTestId('profile-created-at')).toContainText(/\d{4}\/\d{2}\/\d{2}/)

  // 訪客的 User.email 是 null，那一列整個不渲染（不是渲染成空字串）
  await expect(page.getByTestId('profile-email')).toHaveCount(0)
})

// Given 我是訪客且在 /profile
// When  頁面載入
// Then  頭像是預設的 circle-user icon，不是「訪」的首字頭像
//
// 每一位訪客的 displayName 都是同一個固定字串「訪客」（schema.prisma），
// 首字頭像因此對誰都認不出來、也不是他自己選的——退到預設 icon 那一層。
test('訪客的頭像是預設的 circle-user icon，不是「訪」的首字頭像', async ({ page }) => {
  await openProfile(page)

  await expect(page.getByTestId('profile-avatar-icon')).toBeVisible()

  await expect(page.getByTestId('profile-avatar-initial')).toHaveCount(0)
  // 訪客沒有 Google 頭像也不能上傳，所以連 <img> 都不該出現
  await expect(page.getByTestId('profile-avatar-image')).toHaveCount(0)
})

// Given 我是訪客且在 /profile
// When  我尋找可以修改的東西
// Then  名稱旁沒有編輯入口，也沒有「更換頭像」或「移除頭像」——整頁是唯讀的，只有登出可按
test('整頁唯讀：沒有改名入口、沒有更換或移除頭像，只有登出可按', async ({ page }) => {
  await openProfile(page)

  const account = page.getByTestId('profile-account')

  await expect(page.getByTestId('profile-name-edit')).toHaveCount(0)
  await expect(page.getByTestId('profile-name-form')).toHaveCount(0)
  // 改頭像的入口一定帶著一個檔案選擇欄位（#168 的縮圖也是從它開始），
  // 所以「頁面上一個 input[type=file] 都沒有」比逐個找按鈕文案穩
  await expect(page.locator('input[type="file"]')).toHaveCount(0)
  // 唯讀還有另一半：沒有任何可輸入的欄位
  await expect(account.getByRole('textbox')).toHaveCount(0)

  // 「只有登出可按」——帳號區塊裡按得下去的東西剛好一個，而且就是登出。
  // 頁首那顆返回首頁是 <a>（導覽，不是修改），本來就不在這個範圍裡。
  const buttons = account.getByRole('button')

  await expect(buttons).toHaveCount(1)
  await expect(buttons).toHaveAttribute('data-testid', 'profile-logout')
})

// Given 我是訪客，繞過畫面直接以 PATCH /api/profile 送出合法的名字
// When  請求送達
// Then  回傳 403，重新整理後名稱仍是「訪客」
//
// 用同一個 browser context 的 cookie 送，不經過畫面：畫面本來就沒有入口，
// 這條要驗的是「入口沒有」之外，server 自己也守得住（#171）。
test('訪客直接 PATCH /api/profile 得到 403，重新整理後名稱仍是「訪客」', async ({ page }) => {
  await openProfile(page)

  // 送一個完全合格的名字：被擋的理由必須是身分，不是格式
  const response = await page.request.patch('/api/profile', {
    data: { displayName: '我自己取的名字' },
  })

  expect(response.status()).toBe(403)
  expect((await response.json() as { data?: { message?: string } }).data?.message)
    .toBe('訪客的顯示名稱固定為「訪客」，改用 Google 登入後才能修改。')

  await page.reload()

  await expect(page.getByTestId('profile-account')).toBeVisible()
  await expect(page.getByTestId('profile-display-name')).toHaveText('訪客')

  // 畫面沒變還可能是前端沒重新取資料——再從 API 這一側確認一次真的沒寫進去
  const profile = await (await page.request.get('/api/profile')).json() as ProfileBody

  expect(profile.displayName).toBe('訪客')
})

// Given 我是訪客，繞過畫面直接呼叫 POST /api/profile/avatar
// When  請求送達
// Then  回傳 403，不建立任何 Blob
//
// 「不建立任何 Blob」在這裡看得到的形式是「profile 上沒有留下任何頭像網址」——
// 這條 E2E 不碰 Blob store（沒有 token、也沒有收尾清理），觀測點只有這一個。
// 上傳成功那條路徑上「舊 Blob 有沒有被刪掉」由 tests/unit/server/avatar-upload.test.ts
// 覆蓋（store 是替身）。
test('訪客直接 POST /api/profile/avatar 得到 403，沒有留下任何 Blob', async ({ page }) => {
  await openProfile(page)

  const response = await page.request.post('/api/profile/avatar', {
    multipart: { file: { name: 'avatar.png', mimeType: 'image/png', buffer: TINY_PNG } },
  })

  expect(response.status()).toBe(403)
  expect((await response.json() as { data?: { message?: string } }).data?.message)
    .toBe('訪客不能上傳頭像，改用 Google 登入後才能設定。')

  const profile = await (await page.request.get('/api/profile')).json() as ProfileBody

  expect(profile.avatarUrl).toBeNull()
  expect(profile.avatarSource).toBe('none')

  // 畫面也維持原狀：仍然是預設 icon，沒有多出一張圖
  await page.reload()

  await expect(page.getByTestId('profile-avatar-icon')).toBeVisible()
  await expect(page.getByTestId('profile-avatar-image')).toHaveCount(0)
})

// Given 我在 /profile
// When  我按下「登出」
// Then  回到 /login；此時直接輸入 /profile 會再次被導向 /login
//
// 登出只影響這個 test 自己的 context（每個 test 一個瀏覽器 context、一位訪客），
// 不會把其他並行中的 test 一起登出。
test('按下登出回到 /login，之後直接開 /profile 會再次被導向 /login', async ({ page }) => {
  await openProfile(page)

  await page.getByTestId('profile-logout').click()

  await expect(page).toHaveURL(/\/login$/)
  // 等的是登入頁自己出現，不只是網址變了——導向後整頁壞掉時網址一樣是對的
  await expect(page.getByTestId('login-screen')).toBeVisible()

  // cookie 真的清掉了才算登出：受保護的頁面要再次把人擋在門外
  await page.goto('/profile')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByTestId('login-screen')).toBeVisible()
  await expect(page.getByTestId('profile-account')).toHaveCount(0)
})

// Given 我在首頁
// When  頁面渲染完成
// Then  右上角入口是固定的 circle-user icon，不渲染任何 img
//
// 入口刻意不顯示頭像（#162）：頁首在有 Google 頭像時會多打一次外部圖片請求，
// 而訪客根本沒有頭像可顯示——固定 icon 讓兩種身分看到的入口完全一樣。
test('首頁右上角的入口是固定的 circle-user icon，不渲染任何 img', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('home-sticky-header')).toBeVisible()

  const entry = page.getByTestId('tank-header-profile')

  await expect(entry).toHaveAttribute('href', '/profile')
  // 正面訊號：那個 icon 真的在畫面上，而且就是 circle-user 那一個
  await expect(page.getByTestId('tank-header-profile-icon')).toBeVisible()
  await expect(page.getByTestId('tank-header-profile-icon')).toHaveClass(/circle-user/)

  await expect(entry.locator('img')).toHaveCount(0)
  // 也沒有名稱首字之類的文字——入口對誰都長得一樣
  await expect(entry).toHaveText('')
})
