import type { GuestSandboxResponse } from '#shared/types/guestSandbox'

// POST /api/guest-sandbox —— 補上這位使用者欠著的示範資料（issue #144）。
//
// 為什麼是 POST：它會寫入。GET 的話瀏覽器與爬蟲的預取就能觸發整份沙盒的複製，
// 而 /auth/guest 已經因為是 GET 而付過一次代價了（見 server/routes/auth/guest.get.ts）。
//
// 掛在 server/api/ 而不是 server/routes/：這一支是給前端 fetch 的端點，不是導向的終點。
//
// 「誰可以呼叫」與「要不要真的複製」都在 server/utils/authorization.ts 與
// guestSandbox.ts——這裡只負責把它的答案變成 HTTP 回應。
export default defineEventHandler(async (event): Promise<GuestSandboxResponse> => {
  const result = await resolveGuestSandbox(prisma, await getCurrentUser(event))

  if (!result.ok) {
    throw createError(result.error)
  }

  return result.value
})
