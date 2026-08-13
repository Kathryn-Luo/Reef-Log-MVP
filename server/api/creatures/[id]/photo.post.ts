import type { CreatureProfileResponse } from '#shared/types/creature'

// POST /api/creatures/:id/photo —— 上傳生物照片，回傳更新後的那一隻（issue #154）
export default defineEventHandler(async (event): Promise<CreatureProfileResponse> => {
  const result = await updateOwnedCreaturePhoto(
    prisma,
    await getCurrentUser(event),
    getRouterParam(event, 'id'),
    // thunk，不是 `await readMultipartFormData(event)`：未登入、訪客與打別人生物的請求
    // 都要在**讀進任何檔案內容之前**就結束。寫成參數位置的 await 的話，那些人一樣能讓
    // server 先把整份檔案收下來（與 /api/profile/avatar 同一個作法）。
    () => readMultipartFormData(event),
  )

  if (!result.ok) {
    throw createError(result.error)
  }

  return result.value
})
