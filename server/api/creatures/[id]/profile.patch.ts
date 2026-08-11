import type { CreatureProfileResponse } from '#shared/types/creature'

export default defineEventHandler(async (event): Promise<CreatureProfileResponse> => {
  const result = await updateOwnedCreatureProfile(
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
