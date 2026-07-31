import type { CreatureDetailResponse } from '#shared/types/creature'

// 更新狀態與死亡 / 生病記錄（screen-6 的狀態切換 + 死亡記錄區塊）。
//
// 六支 API 裡唯一「擋不住就會改到別人資料」的一支。歸屬檢查、欄位規則與
// 「入缸日不由請求提供」都在 server/utils/authorization.ts 的 applyCreatureStatus，
// 被擋下來時一次寫入都不會發生。
export default defineEventHandler(async (event): Promise<CreatureDetailResponse> => {
  const result = await applyCreatureStatus(
    prisma,
    await getCurrentUser(event),
    getRouterParam(event, 'id'),
    await readBody(event),
  )

  if (!result.ok) {
    throw createError(result.error)
  }

  return result.value
})
