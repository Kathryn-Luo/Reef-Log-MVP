export default defineEventHandler(async (event): Promise<Record<string, never>> => {
  const result = await createOwnedWaterLog(prisma, await getCurrentUser(event), getRouterParam(event, 'id'), () => readBody(event))
  if (!result.ok) {
    throw createError(result.error)
  }
  return result.value
})
