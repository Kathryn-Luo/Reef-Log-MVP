import { expect, test } from './support/guestSession'
import { test as base } from '@playwright/test'

// 自訂頭像上傳（issue #166）。E2E 不在 TDD Develop 的 job 內執行，跑在 Vercel preview URL 上。
//
// ⚠ 這一支能驗的東西比它看起來少很多，而且是刻意的。
//
// Epic #160（2026-08-12）定案**訪客不得上傳頭像**，而 Vercel preview 上唯一登得進去的
// 身分就是訪客——Google 不支援萬用字元 redirect URI，OAuth 在 preview 走不通（CLAUDE.md）。
// 兩件事湊起來：上傳成功、三道格式檢查、2 MB 上限、換圖時刪舊 Blob，在這裡**一條都跑不到**，
// 因為根本沒有一個「能上傳的身分」可以拿來登入。
//
// 那些路徑由 tests/unit/server/avatar-upload.test.ts 覆蓋（Blob store 是替身），
// 並由人類在 localhost 或 production 以 Google 帳號人工確認一次。
// 前端縮圖的真實瀏覽器驗證見 #176——那要用真的 Chromium，而不是真的部署。
//
// **不要**為了讓這一支「測到更多東西」而放寬 #166 的 403，也不要在 E2E 裡直接改資料庫。
// 那個 403 是本輪刻意的決定，不是待補的缺口。

/** 最小的合法 PNG（1×1 透明）——base64 來自 PNG 規格中最短的可解碼檔案 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

/** 一份 SVG——它一定要被擋下來，瀏覽器會把它當成可執行的標記處理 */
const SVG_SOURCE = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

function upload(name: string, mimeType: string, buffer: Buffer) {
  return { multipart: { file: { name, mimeType, buffer } } }
}

// Given 我未登入
// When  我呼叫 POST /api/profile/avatar
// Then  回傳 401
base('未登入打 POST /api/profile/avatar 得到 401', async ({ request }) => {
  const response = await request.post('/api/profile/avatar', upload('avatar.png', 'image/png', TINY_PNG))

  expect(response.status()).toBe(401)
  expect((await response.json() as { data?: { message?: string } }).data?.message).toBe('未登入，請先登入後再試一次。')
})

test.describe('訪客不得上傳頭像', () => {
  // Given 我是訪客，並選了一張完全合法的 PNG
  // When  我呼叫 POST /api/profile/avatar
  // Then  回傳 403，且我的頭像一點都沒變
  test('合法的 PNG 也是 403，頭像維持原狀', async ({ page }) => {
    const before = await (await page.request.get('/api/profile')).json() as { avatarUrl: string | null }

    const response = await page.request.post('/api/profile/avatar', upload('avatar.png', 'image/png', TINY_PNG))

    expect(response.status()).toBe(403)
    expect((await response.json() as { data?: { message?: string } }).data?.message)
      .toBe('訪客不能上傳頭像，改用 Google 登入後才能設定。')

    const after = await (await page.request.get('/api/profile')).json() as { avatarUrl: string | null }
    expect(after.avatarUrl).toBe(before.avatarUrl)
  })

  // Given 我是訪客，而且送的檔案本身也不合格
  // When  請求送達 API
  // Then  仍然是 403 而不是 400——訪客拿到的答案與他送什麼檔案無關
  test('送 SVG 得到的仍是 403，不是「格式不支援」的 400', async ({ page }) => {
    const response = await page.request.post('/api/profile/avatar', upload('avatar.svg', 'image/svg+xml', SVG_SOURCE))

    expect(response.status()).toBe(403)
  })

  // Given 我是訪客
  // When  我送一份超過 2 MB 的檔案
  // Then  仍然是 403。這條順便證明 server 在讀完 multipart 之前就把我擋掉了——
  //       若順序寫反，先跑的會是大小檢查，回的就會是 400
  test('超過 2 MB 也是 403，證明擋在讀取檔案之前', async ({ page }) => {
    const oversized = Buffer.concat([TINY_PNG, Buffer.alloc(2 * 1024 * 1024)])

    const response = await page.request.post('/api/profile/avatar', upload('avatar.png', 'image/png', oversized))

    expect(response.status()).toBe(403)
  })
})
