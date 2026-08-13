import type { CreatureSuggestionsResponse } from '#shared/types/creature'

// GET /api/creature-suggestions —— 目前使用者過去輸入過的學名與細分類（issue #159）
export default defineEventHandler(async (event): Promise<CreatureSuggestionsResponse> => {
  const result = await resolveCreatureSuggestions(prisma, await getCurrentUser(event))

  if (!result.ok) {
    throw createError(result.error)
  }

  return result.value
})
