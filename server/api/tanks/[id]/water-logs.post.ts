import type { CreateWaterLogResponse } from '#shared/types/waterLog'

// 儲存一筆水質量測（screen-3 的「儲存這筆記錄」）。
//
// 歸屬檢查、內容驗證與寫入全在 server/utils/authorization.ts 的 createOwnedWaterLog——
// 與其他資料 API 同一道邊界。
//
// body 傳的是函式而不是值：`await readBody(event)` 會在身分判斷之前就執行，
// 而它對畸形 JSON 直接 throw 400，未登入或打別人缸的人因此拿得到 400 而不是 401 / 404。
export default defineEventHandler(async (event): Promise<CreateWaterLogResponse> => {
  const result = await createOwnedWaterLog(prisma, await getCurrentUser(event), getRouterParam(event, 'id'), () => readBody(event))

  if (!result.ok) {
    throw createError(result.error)
  }

  return result.value
})
