import type { UserProfileResponse } from '#shared/types/profile'

// PATCH /api/profile —— 只修改當前登入使用者的顯示名稱
export default defineEventHandler(async (event): Promise<UserProfileResponse> => {
  const result = await updateOwnedProfile(
    prisma,
    await getCurrentUser(event),
    () => readBody(event),
  )

  if (!result.ok) {
    throw createError(result.error)
  }

  return result.value
})
