import type { TrendPageData } from '#shared/types/trend'

// 趨勢頁（screen-4）要的資料：六個測項的序列、統計與正常區間。
//
// 歸屬檢查在 server/utils/authorization.ts 的 resolveTrendPage——與其他資料 API
// 同一道邊界，別人的缸一律 404。`range` 原封不動地送進去，解析排在身分與歸屬之後：
// 在這裡先擋掉不合法的值的話，未登入的人會拿到 400 而不是 401（理由寫在 resolveTrendPage）。
export default defineEventHandler(async (event): Promise<TrendPageData> => {
  const result = await resolveTrendPage(
    prisma,
    await getCurrentUser(event),
    getRouterParam(event, 'id'),
    getQuery(event).range,
  )

  if (!result.ok) {
    throw createError(result.error)
  }

  return result.value
})
