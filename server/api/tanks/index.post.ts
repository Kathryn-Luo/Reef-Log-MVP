import type { CreateTankResponse } from '#shared/types/tank'

// 建立缸。首頁空狀態的「建立第一個缸」與缸切換選單的「新增缸」都送到這裡。
//
// 新缸掛在誰名下、欄位規則、未登入怎麼回，全在 server/utils/authorization.ts 的
// createOwnedTank——與五支讀取 API 同一道邊界。
//
// body 傳的是函式而不是值：`await readBody(event)` 會在身分判斷之前就執行，
// 而它對畸形 JSON 直接 throw 400，未登入的人因此拿得到 400 而不是 401。
export default defineEventHandler(async (event): Promise<CreateTankResponse> => {
  const result = await createOwnedTank(prisma, await getCurrentUser(event), () => readBody(event))

  if (!result.ok) {
    throw createError(result.error)
  }

  return result.value
})
