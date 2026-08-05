import type { WaterLogPageData } from '#shared/types/waterLog'

export default defineEventHandler(async (event): Promise<WaterLogPageData> => {
  const result = await resolveWaterLogPage(prisma, await getCurrentUser(event), getRouterParam(event, 'id'))
  if (!result.ok) {
    throw createError(result.error)
  }
  return result.value
})
