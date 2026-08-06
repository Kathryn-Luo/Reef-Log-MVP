import type { MaintenanceTaskResponse } from '#shared/types/maintenance'

// 勾選今天的保養（screen-7 的 checkbox）。
//
// 用 POST / DELETE 兩支，而不是一支帶 { completed: boolean } 的 PATCH：這兩支天生冪等
// ——POST 走 @@unique([taskId, completedOn]) 的 upsert——「連點兩下只會有一筆」因此是
// 資料庫約束給的保證，不是應用層自己小心的結果。
//
// 歸屬檢查、內容驗證與寫入全在 server/utils/authorization.ts 的 resolveCompleteTask。
// body 傳的是函式而不是值：`await readBody(event)` 會在身分判斷之前就執行，
// 而它對畸形 JSON 直接 throw 400，未登入或打別人任務的人因此拿得到 400 而不是 401 / 404。
export default defineEventHandler(async (event): Promise<MaintenanceTaskResponse> => {
  const result = await resolveCompleteTask(
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
