import type { TankHomeData } from '#shared/types/home'

// screen-1 單一缸的內容：最新一筆水質記錄 + 該缸全部生物。
//
// 只允許取當前使用者名下、未封存的缸——缸切換選單就是由同一份清單產生的，
// 網址被改成別人的 tankId 時不該回傳資料。
export default defineEventHandler(async (event): Promise<TankHomeData> => {
  const tankId = getRouterParam(event, 'id')

  if (!tankId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing tank id' })
  }

  const user = await getCurrentUser(event)
  const tanks = user ? await listTankOptions(prisma, user.id) : []

  if (!tanks.some(tank => tank.id === tankId)) {
    throw createError({ statusCode: 404, statusMessage: 'Tank not found' })
  }

  return getTankHome(prisma, tankId)
})
