import type { UserProfileResponse } from '#shared/types/profile'

// DELETE /api/profile/avatar —— 移除自訂頭像，回傳退回後的有效頭像（issue #167）
export default defineEventHandler(async (event): Promise<UserProfileResponse> => {
  // 這裡不讀 body、不讀 query：要刪哪一個 Blob 只由 removeOwnedAvatar 從自己的
  // User.customAvatarUrl 讀出來決定。client 送來的 URL 連進入這支 handler 的機會都沒有。
  const result = await removeOwnedAvatar(prisma, await getCurrentUser(event))

  if (!result.ok) {
    throw createError(result.error)
  }

  return result.value
})
