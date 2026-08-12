import { expect, test } from './support/guestSession'
import { test as base } from '@playwright/test'

// 自訂頭像上傳（issue #166）。E2E 不在 TDD Develop 的 job 內執行，跑在 Vercel preview URL 上。
//
// 為什麼一定要有這一層：unit 測試驗的是 `updateOwnedAvatar` 這支純函式與它的 handler
// 有沒有接上（讀原始碼），Blob store 在那裡是替身。真正走一遍 multipart HTTP、帶著真的
// 密封 cookie、把位元組送進**這個部署環境自己的** Blob store、再寫進 Neon 的，只有這裡。
// Story 講的「新 Blob 建立在目前部署環境對應的 store」在 unit 那一層本來就驗不到。
//
// 送出的是最小的合法圖片，不是 512 px 的縮圖：這一支要的是「這條路徑通不通」，
// 不是影像品質。前端縮圖是 #168 的題目。

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

test.describe('已登入的頭像上傳', () => {
  // Given 我已登入，並選了一張不超過 2 MB 的 PNG
  // When  我呼叫 POST /api/profile/avatar
  // Then  User.customAvatarUrl 指向新 URL，回應帶回解析後的有效頭像
  test('上傳 PNG 之後 profile 回報 custom 來源的新頭像', async ({ page }) => {
    const response = await page.request.post('/api/profile/avatar', upload('avatar.png', 'image/png', TINY_PNG))

    expect(response.status()).toBe(200)

    const body = await response.json() as { avatarUrl: string | null, avatarSource: string }

    expect(body.avatarSource).toBe('custom')
    expect(body.avatarUrl).toContain('/avatars/')

    // 圖片真的存在於這個環境的 store 裡，而且是可公開讀取的
    const stored = await page.request.get(body.avatarUrl!)
    expect(stored.status()).toBe(200)

    // 重新讀一次 profile：寫進資料庫的就是剛剛那個 URL
    const profile = await (await page.request.get('/api/profile')).json() as { avatarUrl: string | null }
    expect(profile.avatarUrl).toBe(body.avatarUrl)
  })

  // Given 我上傳 SVG
  // When  請求送達 API
  // Then  回傳明確的 400，不修改 User
  test('SVG 被擋下來，頭像維持原狀', async ({ page }) => {
    const before = await (await page.request.get('/api/profile')).json() as { avatarUrl: string | null }

    const response = await page.request.post('/api/profile/avatar', upload('avatar.svg', 'image/svg+xml', SVG_SOURCE))

    expect(response.status()).toBe(400)
    expect((await response.json() as { data?: { message?: string } }).data?.message)
      .toBe('頭像只接受 JPEG、PNG 或 WebP 圖片。')

    const after = await (await page.request.get('/api/profile')).json() as { avatarUrl: string | null }
    expect(after.avatarUrl).toBe(before.avatarUrl)
  })

  // Given 我上傳的檔案宣稱是 image/png，但 magic bytes 不是 PNG
  // When  請求送達 API
  // Then  回傳明確的 400
  test('宣稱 image/png 的 SVG 也被擋下來', async ({ page }) => {
    const response = await page.request.post('/api/profile/avatar', upload('avatar.png', 'image/png', SVG_SOURCE))

    expect(response.status()).toBe(400)
    expect((await response.json() as { data?: { message?: string } }).data?.message)
      .toBe('頭像只接受 JPEG、PNG 或 WebP 圖片。')
  })

  // Given 我上傳超過 2 MB 的檔案
  // When  請求送達 API
  // Then  回傳明確的 400，且與「格式不支援」是分得開的兩句話
  test('超過 2 MB 的 PNG 得到「太大」而不是「格式不支援」', async ({ page }) => {
    // 檔頭是合法 PNG，後面補到超過 2 MB：擋下它的必須是大小那一關
    const oversized = Buffer.concat([TINY_PNG, Buffer.alloc(2 * 1024 * 1024)])

    const response = await page.request.post('/api/profile/avatar', upload('avatar.png', 'image/png', oversized))

    expect(response.status()).toBe(400)
    expect((await response.json() as { data?: { message?: string } }).data?.message)
      .toBe('圖片請控制在 2 MB 以內。')
  })

  // Given 我上傳成功且原本已有一張自訂頭像
  // When  DB 成功改指向新 URL 之後
  // Then  舊的自訂 Blob 被刪除，新的仍然讀得到
  test('第二次上傳換掉舊圖，舊的 Blob 不再存在', async ({ page }) => {
    const first = await (await page.request.post(
      '/api/profile/avatar',
      upload('avatar.png', 'image/png', TINY_PNG),
    )).json() as { avatarUrl: string }

    const second = await (await page.request.post(
      '/api/profile/avatar',
      upload('avatar.png', 'image/png', TINY_PNG),
    )).json() as { avatarUrl: string }

    // 每次上傳都是一個新的 immutable Blob，不覆寫舊 URL
    expect(second.avatarUrl).not.toBe(first.avatarUrl)

    expect((await page.request.get(second.avatarUrl)).status()).toBe(200)
    await expect.poll(async () => (await page.request.get(first.avatarUrl)).status()).toBe(404)
  })
})
