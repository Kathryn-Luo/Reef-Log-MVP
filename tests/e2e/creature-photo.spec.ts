import { expect, test } from './support/guestSession'

// 生物照片（issue #154）在真實部署上走得到的那一半。
//
// ── 這一支為什麼只驗訪客那一面 ──
//
// preview 上唯一走得通的登入方式是「以訪客身分瀏覽」（Google 不支援萬用字元 redirect
// URI，見 Epic #47），而**訪客不能上傳照片**（GUEST_CANNOT_UPLOAD_PHOTO，理由與頭像
// 的 #166 逐條相同：孤兒 Blob 與匿名上傳濫用）。所以「選一張照片並儲存」那條 Story
// 在 preview 上沒有身分走得完——與頭像上傳（#176 / tests/e2e/profile-avatar-upload.spec.ts）
// 完全相同的處境。
//
// 走得到的是這三件事，而且每一件都是真的 HTTP、真的資料庫、真的 session：
//   ① 訪客開表單時「照片欄位出現、但說明訪客無法上傳」（Story 第三條）
//   ② 那道 403 真的擋得住——不是只有畫面把按鈕藏起來
//   ③ 未登入連 401 都在檔案被讀進 server 之前就回來了
//
// Google 使用者實際上傳一張照片、列表與詳情頁顯示它，仍然只有 production 或本機
// 驗得到（見 PR 說明裡列出的人工確認項目）。

test('訪客開新增生物表單時，照片欄位在，但說明訪客不能上傳', async ({ page }) => {
  await page.goto('/creatures/new')
  await expect(page.getByTestId('creature-profile-form')).toBeVisible()

  // 欄位本身要在：整塊消失的話，人只會以為 ReefLog 沒有照片這個功能
  await expect(page.locator('[data-testid="creature-profile-field"][data-field="photo"]')).toBeVisible()

  const hint = page.getByTestId('creature-photo-guest-hint')

  await expect(hint).toBeVisible()
  await expect(hint).toContainText('訪客')
  await expect(hint).toContainText('Google')

  // 按了必定失敗的入口不該存在
  await expect(page.getByTestId('creature-photo-choose')).toHaveCount(0)
  await expect(page.getByTestId('creature-photo-input')).toHaveCount(0)
})

test('訪客照樣存得下其餘欄位，照片只是沒有而已', async ({ page }) => {
  const name = `E2E 無照片生物 ${Date.now()}`

  await page.goto('/creatures/new')
  await expect(page.getByTestId('creature-profile-form')).toBeVisible()

  await page.locator('[name="name"]').fill(name)
  await page.getByTestId('creature-category-option').filter({ hasText: '魚' }).click()
  await page.locator('[name="addedOn"]').fill(new Date().toISOString().slice(0, 10))
  await page.getByTestId('creature-profile-submit').click()

  await expect(page).toHaveURL(/\/creatures\/[^/]+$/)
  await expect(page.getByTestId('creature-name')).toHaveText(name)
})

// 畫面藏起入口只是 UX。真正的邊界在 server/utils/authorization.ts，而那道 403
// 只有真的送一次 multipart 才驗得到——unit 測試餵的是替身。
test('訪客直接打上傳 API 得到 403，照片沒有被寫進去', async ({ page, context }) => {
  await page.goto('/creatures')

  const { tanks } = await (await context.request.get('/api/tanks')).json() as { tanks: { id: string }[] }
  const tankId = tanks[0]!.id

  const { creatures } = await (await context.request.get(`/api/tanks/${tankId}/creatures`))
    .json() as { creatures: { id: string, photoUrl: string | null }[] }
  const creature = creatures[0]!

  // 一張真的 PNG（IHDR 都不必完整，magic bytes 才是 server 看的東西）——
  // 被擋下來的理由必須是「訪客不能上傳」，不是「這個檔案不合格」
  const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0])

  const response = await context.request.post(`/api/creatures/${creature.id}/photo`, {
    multipart: { file: { name: 'photo.png', mimeType: 'image/png', buffer: png } },
  })

  expect(response.status()).toBe(403)

  const body = await response.json() as { data?: { message?: string } }

  expect(body.data?.message).toContain('訪客')

  // 被拒絕之後那一隻仍然是原樣——狀態碼對了但東西已經寫進去了，是這條路徑最糟的失敗方式
  const after = await (await context.request.get(`/api/creatures/${creature.id}`))
    .json() as { creature: { photoUrl: string | null } }

  expect(after.creature.photoUrl).toBe(creature.photoUrl)
})

test('未登入時兩支照片 API 都回 401', async ({ browser }) => {
  const anonymous = await browser.newContext()

  const responses = await Promise.all([
    anonymous.request.post('/api/creatures/any-creature-id/photo', {
      multipart: { file: { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4E, 0x47]) } },
    }),
    anonymous.request.delete('/api/creatures/any-creature-id/photo'),
  ])

  expect(responses.map(response => response.status())).toEqual([401, 401])

  await anonymous.close()
})
