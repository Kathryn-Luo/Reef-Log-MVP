import type { UserProfileResponse } from '#shared/types/profile'

// POST /api/profile/avatar —— 上傳自訂頭像，回傳解析後的有效頭像（issue #166）
export default defineEventHandler(async (event): Promise<UserProfileResponse> => {
  const result = await updateOwnedAvatar(
    prisma,
    await getCurrentUser(event),
    // thunk，不是 `await readMultipartFormData(event)`：未登入的請求要在**讀進任何
    // 檔案內容之前**就結束（Story 第二條）。寫成參數位置的 await 的話，沒有身分的人
    // 一樣能讓 server 先把整份檔案收下來。
    () => readMultipartFormData(event),
  )

  if (!result.ok) {
    throw createError(result.error)
  }

  return result.value
})
