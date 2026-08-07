import type { MaintenancePageData } from '#shared/types/maintenance'

// 保養提醒頁（screen-7）要的資料：這個缸啟用中的任務，以及每個任務最後一筆完成紀錄。
//
// 「下次到期」「今天該做 / 3 天後」與徽章數字都不在這裡算——它們要問使用者的「今天」，
// 而 server 跑在 UTC（見 shared/utils/maintenance.ts）。
//
// 歸屬檢查在 server/utils/authorization.ts 的 resolveMaintenancePage——
// 與其他資料 API 同一道邊界，別人的缸一律 404。
export default defineEventHandler(async (event): Promise<MaintenancePageData> => {
  const result = await resolveMaintenancePage(prisma, await getCurrentUser(event), getRouterParam(event, 'id'))

  if (!result.ok) {
    throw createError(result.error)
  }

  return result.value
})
