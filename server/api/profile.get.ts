import type { UserProfileResponse } from '#shared/types/profile'

// GET /api/profile —— 回傳帳號資訊與解析後的有效頭像
export default defineEventHandler(async (event): Promise<UserProfileResponse> => {
  const result = await resolveProfile(prisma, await getCurrentUser(event))

  if (!result.ok) {
    throw createError(result.error)
  }

  return result.value
})
