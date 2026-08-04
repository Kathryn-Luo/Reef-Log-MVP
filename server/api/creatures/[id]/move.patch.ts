import type { MoveCreatureResponse } from '#shared/types/creature'

// 後端換缸 API（issue #117）。畫面入口另由設計 issue 決定；這支只接受目標 tankId。
// body 延後讀取，未登入或不屬於自己的來源生物都會先得到既定的 401／404。
export default defineEventHandler(async (event): Promise<MoveCreatureResponse> => {
  const result = await moveOwnedCreature(
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
