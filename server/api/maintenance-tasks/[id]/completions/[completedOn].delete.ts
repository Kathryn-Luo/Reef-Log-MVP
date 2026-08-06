import type { MaintenanceTaskResponse } from '#shared/types/maintenance'

// 取消今天的勾選（screen-7 的 checkbox 再按一次）。
//
// 與 POST 那一支對稱的冪等：走 deleteMany，沒有東西可刪不是錯誤，回的是現況而不是 404。
//
// 歸屬檢查與 completedOn 的驗證在 server/utils/authorization.ts 的 resolveClearCompletion。
export default defineEventHandler(async (event): Promise<MaintenanceTaskResponse> => {
  const result = await resolveClearCompletion(
    prisma,
    await getCurrentUser(event),
    getRouterParam(event, 'id'),
    getRouterParam(event, 'completedOn'),
  )

  if (!result.ok) {
    throw createError(result.error)
  }

  return result.value
})
