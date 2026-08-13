import { expect, test } from './support/guestSession'

// issue #175：辨識出使用者的那一段（`getUserFromSession`）現在會順手更新
// `User.lastActiveAt`，也就是**每一支需要身分的 API 都多走一段寫入路徑**。
//
// 這條路徑在 unit 測試裡全程是假的 Prisma Client——判斷邏輯測得到，
// 「那句 updateMany 在真的資料庫上跑不跑得起來」測不到。而它一旦跑不起來，
// 壞掉的不是某一個畫面，是每一支 API 同時 500。這支 spec 補的就是那一段。
//
// 節流本身（同一分鐘內不重複寫入）不在這裡驗：那是 server 內部的行為，
// 瀏覽器這一側看不見，硬要驗只能去讀資料庫。它的完整案例在
// tests/unit/server/last-active.test.ts。

const AUTHENTICATED_ENDPOINTS = [
  '/api/tanks',
  '/api/profile',
]

// Given 我是已登入的訪客 / When 我在同一分鐘內連續打了多支需要身分的 API
// Then 每一支都正常回應——多出來的那次 lastActiveAt 寫入不會讓請求失敗
test('連續打多支需要身分的 API 都仍然正常回應', async ({ page }) => {
  const request = page.context().request

  for (let round = 0; round < 3; round += 1) {
    for (const endpoint of AUTHENTICATED_ENDPOINTS) {
      const response = await request.get(endpoint)

      expect(response.status(), `${endpoint} 第 ${round + 1} 次回了 ${response.status()}：${await response.text()}`)
        .toBe(200)
    }
  }
})

// Given 我是已登入的訪客，而每次請求都會更新我的 lastActiveAt
// When  我重新整理首頁
// Then  我仍然是同一位訪客，看到的還是自己那一份沙盒（更新沒有動到身分）
test('重新整理後仍是同一位訪客，沙盒沒有變', async ({ page }) => {
  const request = page.context().request

  const tanksOf = async () => {
    const response = await request.get('/api/tanks')
    expect(response.status()).toBe(200)

    const { tanks } = (await response.json()) as { tanks: { id: string }[] }

    return tanks.map(tank => tank.id).sort()
  }

  const before = await tanksOf()
  expect(before.length).toBeGreaterThan(0)

  await page.reload()
  await expect(page).toHaveURL('/')

  expect(await tanksOf()).toEqual(before)
})
