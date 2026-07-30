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
export function getCurrentUser(event: InstanceType<typeof H3Event>): Promise<User | null> {
  return getUserSession(event).then(session => getUserFromSession(prisma, session, new Date()))
}
