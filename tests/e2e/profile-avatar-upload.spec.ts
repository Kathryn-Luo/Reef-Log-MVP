import { expect, test } from './support/guestSession'

// Profile 頁的頭像上傳與移除介面（issue #168）。
// E2E 不在 TDD Develop 的 job 內執行，跑在 Vercel preview URL 上。
//
// ⚠ 這一支驗得到的東西比 Story 少很多，而且是刻意的。
//
// Epic #160 定案**訪客不得上傳頭像**（server 一律 403，見 GUEST_CANNOT_UPLOAD_AVATAR），
// 而 preview 上唯一登得進去的身分就是訪客——Google 不支援萬用字元 redirect URI，OAuth
// 在 preview 走不通（CLAUDE.md）。所以「選一張圖 → 縮圖 → 上傳成功 → 換成新頭像」這條
// 主線在這裡一步都走不到，因為根本沒有一個「能上傳的身分」可以拿來登入。
//
// 各條 Story 的落點因此是：
//   - 縮圖規格（512 / WebP / 只縮不放 / EXIF 方向）→ tests/unit/app/resize-avatar.test.ts
//   - 畫面行為（accept、重複送出、兩種 400、移除的確認）→ tests/unit/pages/profile-avatar.test.ts
//   - 手機的原生選單與 EXIF 方向 → 由人類在實機上確認一次（本 issue 的「測試」段已載明）
//
// 留在這裡的是訪客這個身分**看得到**的那一半，以及首頁入口的回歸保護。
// **不要**為了讓這一支「測到更多東西」而放寬 #166 的 403，也不要在 E2E 裡直接改資料庫。

test.describe('訪客的 Profile 頁', () => {
  // Given 我是訪客（server 對上傳一律回 403）
  // When  我開啟 /profile
  // Then  畫面上沒有那個按了必定失敗的上傳入口
  test('沒有上傳入口與檔案輸入', async ({ page }) => {
    await page.goto('/profile')

    await expect(page.getByTestId('profile-account')).toBeVisible()
    await expect(page.getByTestId('profile-avatar-upload')).toHaveCount(0)
    await expect(page.getByTestId('profile-avatar-input')).toHaveCount(0)
  })

  // Given 我沒有自訂頭像
  // When  我開啟 /profile
  // Then  不顯示「移除頭像」這個動作（沒有東西可以移除）
  test('沒有自訂頭像就沒有「移除頭像」', async ({ page }) => {
    await page.goto('/profile')

    await expect(page.getByTestId('profile-account')).toBeVisible()
    await expect(page.getByTestId('profile-avatar-remove')).toHaveCount(0)

    // 訪客的名字是系統給的，首字對他沒有意義——退到預設 icon 那一層（#180）
    await expect(page.getByTestId('profile-avatar-icon')).toBeVisible()
  })

  // Then 畫面上不出現 2 MB 這個數字：前端縮圖之後使用者永遠碰不到它，
  //      寫出來只會造成「我的照片 5 MB 是不是不能傳」的誤解
  test('不在畫面上寫出 2 MB 這個上限', async ({ page }) => {
    await page.goto('/profile')

    await expect(page.getByTestId('profile-account')).toBeVisible()
    await expect(page.getByTestId('profile-account')).not.toContainText('MB')
  })
})

// Then 首頁右上角入口仍維持固定的 circle-user icon
//
// 這一輪動的是 Profile 頁，首頁入口一個字都不該變（Epic #160 定案，見 #172）。
test('首頁右上角的 Profile 入口仍是固定的 icon，不是頭像照片', async ({ page }) => {
  const entrance = page.getByTestId('tank-header-profile')

  await expect(entrance).toBeVisible()
  await expect(entrance).toHaveAttribute('href', '/profile')
  await expect(entrance.locator('img')).toHaveCount(0)
})
