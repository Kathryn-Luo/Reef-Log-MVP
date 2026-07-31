import type { CreatureDetailResponse } from '#shared/types/creature'

// screen-6 生物詳情：單一生物的完整資料。
//
// 路由掛在 /api/creatures/:id 而不是 /api/tanks/:tankId/creatures/:id：
// 詳情頁是從列表點進來的，手上只有 creatureId；缸的歸屬由
// server/utils/authorization.ts 的 resolveCreatureDetail 透過 tank 反查。
export default defineEventHandler(async (event): Promise<CreatureDetailResponse> => {
  const result = await resolveCreatureDetail(prisma, await getCurrentUser(event), getRouterParam(event, 'id'))

  if (!result.ok) {
    throw createError(result.error)
  }

  return result.value
})
