import type { TankCreaturesData } from '#shared/types/creature'

// screen-5 生物庫存：該缸的全部生物（分類與狀態的篩選在前端套用）。
//
// 只允許取當前使用者名下、未封存的缸——與 /api/tanks/:id/home 同一道檢查，
// 網址被改成別人的 tankId 時不該回傳資料。
export default defineEventHandler(async (event): Promise<TankCreaturesData> => {
  const tankId = getRouterParam(event, 'id')

  if (!tankId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing tank id' })
  }

  const user = await getCurrentUser(event)
  const tanks = user ? await listTankOptions(prisma, user.id) : []

  if (!tanks.some(tank => tank.id === tankId)) {
    throw createError({ statusCode: 404, statusMessage: 'Tank not found' })
  }

  return { creatures: await getTankCreatures(prisma, tankId) }
})
