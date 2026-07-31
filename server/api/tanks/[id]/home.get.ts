import type { TankHomeData } from '#shared/types/home'

// screen-1 單一缸的內容：最新一筆水質記錄 + 該缸全部生物。
//
// 網址被改成別人的 tankId 時回 404、未登入時回 401——判斷在
// server/utils/authorization.ts 的 resolveTankHome，六支 API 共用同一道邊界。
export default defineEventHandler(async (event): Promise<TankHomeData> => {
  const result = await resolveTankHome(prisma, await getCurrentUser(event), getRouterParam(event, 'id'))

  if (!result.ok) {
    throw createError(result.error)
  }

  return result.value
})
