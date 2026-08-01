import type { TankCreaturesData } from '#shared/types/creature'

// screen-5 生物庫存：該缸的全部生物（分類與狀態的篩選在前端套用）。
//
// 與 /api/tanks/:id/home 同一道檢查，只是取的內容不同：
// server/utils/authorization.ts 的 resolveTankCreatures。
export default defineEventHandler(async (event): Promise<TankCreaturesData> => {
  const result = await resolveTankCreatures(prisma, await getCurrentUser(event), getRouterParam(event, 'id'))

  if (!result.ok) {
    throw createError(result.error)
  }

  return result.value
})
