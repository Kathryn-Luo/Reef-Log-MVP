import type { CreatureDetailResponse } from '#shared/types/creature'

// screen-6 生物詳情：單一生物的完整資料。
//
// 路由掛在 /api/creatures/:id 而不是 /api/tanks/:tankId/creatures/:id：
// 詳情頁是從列表點進來的，手上只有 creatureId；缸的歸屬由 getCreatureDetail
// 透過 tank 檢查，網址被改成別人的 id 一樣拿不到資料。
export default defineEventHandler(async (event): Promise<CreatureDetailResponse> => {
  const creatureId = getRouterParam(event, 'id')

  if (!creatureId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing creature id' })
  }

  const user = await getCurrentUser(prisma)
  const creature = user ? await getCreatureDetail(prisma, creatureId, user.id) : null

  if (!creature) {
    // 「不存在」與「不屬於你」回同一個 404：分開回答等於告訴對方這個 id 存在
    throw createError({ statusCode: 404, statusMessage: 'Creature not found' })
  }

  return { creature }
})
