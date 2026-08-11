import type { MaintenanceTaskResponse } from '#shared/types/maintenance'

export default defineEventHandler(async (event): Promise<MaintenanceTaskResponse> => {
  const result = await createOwnedMaintenanceTask(
    prisma,
    await getCurrentUser(event),
    getRouterParam(event, 'id'),
    () => readBody(event),
  )

  if (!result.ok) {
    throw createError(result.error)
  }

  return result.value
})
