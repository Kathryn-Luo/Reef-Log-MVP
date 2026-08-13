import type { CreatureProfileResponse } from '#shared/types/creature'

// DELETE /api/creatures/:id/photo —— 移除生物照片，回傳更新後的那一隻（issue #154）
export default defineEventHandler(async (event): Promise<CreatureProfileResponse> => {
  // 除了網址上那一段 id 之外不讀 body、不讀 query：要刪哪一個 Blob 只由
  // removeOwnedCreaturePhoto 從那一隻自己的 photoUrl 讀出來決定。
  // client 送來的 URL 連進入這支 handler 的機會都沒有。
  const result = await removeOwnedCreaturePhoto(prisma, await getCurrentUser(event), getRouterParam(event, 'id'))

  if (!result.ok) {
    throw createError(result.error)
  }

  return result.value
})
