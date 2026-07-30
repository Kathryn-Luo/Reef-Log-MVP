import { parseCreatureStatusInput } from '#shared/utils/creatureDetail'
import type { CreatureDetailResponse } from '#shared/types/creature'

// 更新狀態與死亡 / 生病記錄（screen-6 的狀態切換 + 死亡記錄區塊）。
//
// 欄位規則走 shared/utils/creatureDetail.ts，與詳情頁同一份：頁面先擋一次是為了
// 不必等來回，這裡再擋一次是因為請求不一定來自那個頁面。
export default defineEventHandler(async (event): Promise<CreatureDetailResponse> => {
  const creatureId = getRouterParam(event, 'id')

  if (!creatureId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing creature id' })
  }

  const user = await getCurrentUser(event)
  const current = user ? await getCreatureDetail(prisma, creatureId, user.id) : null

  if (!current) {
    throw createError({ statusCode: 404, statusMessage: 'Creature not found' })
  }

  // 入缸日不由請求提供：日期先後要比的是「這一隻實際的入缸日」，
  // 由 body 帶進來的話，送一個假的入缸日就能繞過「死亡日不能早於入缸日」。
  const parsed = parseCreatureStatusInput(await readBody(event), { addedOn: current.addedOn })

  if (!parsed.ok) {
    // statusMessage 只留 ASCII——h3 會過濾掉非 ASCII 字元，中文訊息改放 data
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid creature status input',
      data: { message: parsed.message },
    })
  }

  return { creature: await updateCreatureStatus(prisma, creatureId, parsed.value) }
})
