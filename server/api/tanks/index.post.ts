import { parseTankInput } from '#shared/utils/tankForm'
import type { CreateTankResponse } from '#shared/types/tank'

// 建立缸。首頁空狀態的「建立第一個缸」與缸切換選單的「新增缸」都送到這裡。
//
// 欄位規則走 shared/utils/tankForm.ts，與表單同一份：表單先擋一次是為了不必等來回，
// 這裡再擋一次是因為請求不一定來自那個表單。
export default defineEventHandler(async (event): Promise<CreateTankResponse> => {
  const parsed = parseTankInput(await readBody(event))

  if (!parsed.ok) {
    // statusMessage 只留 ASCII——h3 會過濾掉非 ASCII 字元，中文訊息改放 data
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid tank input',
      data: { message: parsed.message },
    })
  }

  const user = await getCurrentUser(prisma)

  if (!user) {
    // 認證尚未導入（見 server/utils/currentContext.ts）：一個使用者都沒有時，
    // 無從決定這個缸該掛在誰名下。導入認證（#47）後這裡會變成「未登入」。
    throw createError({ statusCode: 401, statusMessage: 'No current user' })
  }

  return { tank: await createTank(prisma, user.id, parsed.value) }
})
