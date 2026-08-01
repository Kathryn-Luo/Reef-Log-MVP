import type { TankOption } from '#shared/types/home'

// screen-1 頁首的缸切換選單。清單的第一個即為預設缸（見 listTankOptions 的註解）。
//
// 「哪些缸看得到」與「未登入怎麼回」都在 server/utils/authorization.ts——
// 六支 API 共用同一道邊界，這裡只負責把它的答案變成 HTTP 回應。
export default defineEventHandler(async (event): Promise<{ tanks: TankOption[] }> => {
  const result = await resolveTankOptions(prisma, await getCurrentUser(event))

  if (!result.ok) {
    throw createError(result.error)
  }

  return result.value
})
