import type { WaterLogPageData } from '#shared/types/waterLog'

// 水質記錄頁（screen-3）要的資料：歷史記錄，以及每個測項右側的「上次 8.0」。
//
// 歸屬檢查在 server/utils/authorization.ts 的 resolveWaterLogPage——
// 與其他資料 API 同一道邊界，別人的缸一律 404。
export default defineEventHandler(async (event): Promise<WaterLogPageData> => {
  const result = await resolveWaterLogPage(prisma, await getCurrentUser(event), getRouterParam(event, 'id'))

  if (!result.ok) {
    throw createError(result.error)
  }

  return result.value
})
