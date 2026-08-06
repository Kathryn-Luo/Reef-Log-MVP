import type { APIRequestContext } from '@playwright/test'
import { expect, test } from './support/guestSession'

// 量測時間的範圍（issue #128 第 1 節）。E2E 不在 TDD Develop 的 job 內執行，
// 跑在 Vercel preview URL 上。
//
// unit 那一側驗的是 parseWaterLogInput 與 createOwnedWaterLog 兩支純函式；真正走一遍
// HTTP、帶真的密封 cookie、打真的資料庫，並且回頭確認「歷史記錄裡真的沒有多出那一筆」
// 的，只有這裡。Story 講的是「手滑把年份打成 2199」，那條路徑本身要被走過一次。
//
// 身分走共用的訪客登入 fixture（#80）：每個 test 一份自己的沙盒，
// 下面第二條真的會寫入一筆記錄，寫進去也只髒到自己那一份。

/** 這位訪客沙盒裡的第一個缸——示範資料由 prisma/seed.ts 複製而來（#66） */
async function firstTankId(request: APIRequestContext): Promise<string> {
  const { tanks } = await (await request.get('/api/tanks')).json() as { tanks: { id: string }[] }

  expect(tanks.length, '訪客沙盒裡沒有任何缸——preview 的資料庫可能沒跑過 pnpm db:seed').toBeGreaterThan(0)

  return tanks[0]!.id
}

// Given 我送出一筆量測時間在未來的水質記錄
// When  server 收到它
// Then  拒絕並回 400，訊息說明量測時間不合理，且不建立任何資料
test('量測時間打成 2199 年時回 400，歷史記錄沒有多出任何一筆', async ({ page }) => {
  const { request } = page.context()
  const tankId = await firstTankId(request)
  const before = await (await request.get(`/api/tanks/${tankId}/water-logs`)).json() as { waterLogs: unknown[] }

  const response = await request.post(`/api/tanks/${tankId}/water-logs`, {
    data: { measuredAt: '2199-01-01T00:00:00+08:00', readings: { KH: 7.8 } },
  })

  expect(response.status()).toBe(400)

  // 可以直接顯示的中文在 data.message（statusMessage 過不了 h3 的 ASCII 過濾，
  // 見 shared/utils/apiError.ts）
  const body = await response.json() as { data?: { message?: string } }

  expect(body.data?.message).toContain('量測時間')

  // 「回了 400」與「什麼都沒寫進去」是兩件事。歷史依 measuredAt desc 排序，
  // 真的寫進去的話那一筆會出現在最上方，而且永遠賴在那裡。
  const after = await (await request.get(`/api/tanks/${tankId}/water-logs`)).json() as { waterLogs: unknown[] }

  expect(after.waterLogs).toEqual(before.waterLogs)
})

// Given 我送出一筆量測時間是現在（或幾分鐘內的誤差）
// When  server 收到它
// Then  正常建立
test('量測時間是現在、裝置時鐘快 3 分鐘也照樣建立', async ({ page }) => {
  const { request } = page.context()
  const tankId = await firstTankId(request)
  const measuredAt = new Date(Date.now() + 3 * 60_000).toISOString()

  const response = await request.post(`/api/tanks/${tankId}/water-logs`, {
    data: { measuredAt, readings: { KH: 7.8 } },
  })

  expect(response.ok(), '剛量完就記錄是最常見的用法，不能被容差擋掉').toBe(true)

  const { waterLog } = await response.json() as { waterLog: { id: string, measuredAt: string } }

  expect(waterLog.measuredAt).toBe(measuredAt)

  // 建立成功的定義是「它真的進了歷史」，不只是回應長得對
  const { waterLogs } = await (await request.get(`/api/tanks/${tankId}/water-logs`)).json() as {
    waterLogs: { id: string }[]
  }

  expect(waterLogs.map(log => log.id)).toContain(waterLog.id)
})
