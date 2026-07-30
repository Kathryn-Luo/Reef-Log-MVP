import type { User } from '@prisma/client'

// 「這個請求是誰送的」——各 API handler 唯一的取得方式（issue #64）。
//
// 這個檔案刻意只有接線、沒有判斷：判斷全在 currentContext.ts 的 `getUserFromSession()`
// 與 session.ts 的 `readSessionPayload()`，那兩支是純函式，由 unit test 直接呼叫驗證。
// 這裡三個識別字（`getUserSession`、`prisma`、`getUserFromSession`）全是 Nitro 的自動匯入，
// 在 vitest 裡 import 不進來，所以「有沒有真的接上」由 auth-wiring.test.ts 看原始碼守著。
//
// 為什麼放在獨立檔案而不是 currentContext.ts：那一支必須維持「不依賴自動匯入」，
// 才 import 得進測試。混進來會讓整組判斷邏輯一起變得測不到。

/**
 * 收 `event` 而不是 Prisma Client——身分在 request 的密封 cookie 上，
 * 不看 request 就只能回一個對誰都一樣的答案（這正是本 issue 換掉的舊行為）。
 *
 * 沒有 cookie、簽章驗不過或已過期時回 null，而且一次資料庫查詢都不會發出。
 *
 * 型別借道全域的 `H3Event` class：h3 只以 transitive 形式存在，`import ... from 'h3'`
 * 在 pnpm 嚴格模式下解不開；Nitro 產生的型別把它放進全域，取 InstanceType 即可。
 */
export async function getCurrentUser(event: InstanceType<typeof H3Event>): Promise<User | null> {
  let session: unknown

  try {
    session = await getUserSession(event)
  }
  catch (cause) {
    // 讀 session 會拋錯，而且不只是「cookie 壞掉」這種個案：`NUXT_SESSION_PASSWORD`
    // 沒設或不足 32 字元時，h3 連「開一個新的空 session」都會在 seal 那一步失敗
    // （沒有 cookie 的請求也會走到 seal）。沒有這道隔離的話，設定壞掉的後果不是
    // 「大家都沒登入」，而是**每一支 API 都 500**，連首頁都打不開。
    //
    // 退回未登入而不是往外拋：認證壞掉時整個站還讀得到登入頁，人才有辦法看見出了什麼事。
    // 但一定要留 log——靜靜地把所有人登出，是最難查的那種故障。
    console.error('[auth] 讀取 session 失敗，本次請求視為未登入', cause)

    return null
  }

  // 這一段刻意留在 try 外面：資料庫查詢失敗是真的失敗，不該被偽裝成「未登入」
  // 讓畫面變成一個看起來正常的空狀態。
  return getUserFromSession(prisma, session, new Date())
}
