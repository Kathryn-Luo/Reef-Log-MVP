export const DISPLAY_NAME_MAX_LENGTH = 30

export type ParseDisplayNameResult
  = | { ok: true, value: string }
    | { ok: false, message: string }

function hasControlCharacter(text: string): boolean {
  return [...text].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1F || (codePoint >= 0x7F && codePoint <= 0x9F)
  })
}

/** Profile 頁與 PATCH /api/profile 共用的顯示名稱規則。 */
export function parseDisplayName(raw: unknown): ParseDisplayNameResult {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const rawName = typeof source.displayName === 'string' ? source.displayName : ''

  if (hasControlCharacter(rawName)) {
    return { ok: false, message: '顯示名稱不能包含換行或控制字元。' }
  }

  const displayName = rawName.trim()

  if (!displayName) {
    return { ok: false, message: '請輸入顯示名稱。' }
  }

  if ([...displayName].length > DISPLAY_NAME_MAX_LENGTH) {
    return { ok: false, message: `顯示名稱請控制在 ${DISPLAY_NAME_MAX_LENGTH} 個字以內。` }
  }

  return { ok: true, value: displayName }
}

/**
 * 這個帳號的 `displayName` 是不是使用者自己的名字。
 *
 * 純訪客不是：`server/utils/guestLogin.ts` 對每一位訪客都寫入同一個固定字串「訪客」
 * （見 `prisma/schema.prisma` 的 `User.displayName`）。兩個地方因此都看這個判斷——
 *
 *   - 改名：訪客不能改（#171，server 回 403）
 *   - 首字頭像：訪客不顯示，直接用預設 icon。每一位訪客都會看到同一個「訪」，
 *     那個字認不出任何人，也不是他選的
 *
 * 判斷是「有沒有任何非 `GUEST` 的 provider」，**不是**「名字等不等於『訪客』」：
 * Google 使用者可以把自己的名字改成「訪客」，那仍然是他自己選的名字。
 */
export function ownsDisplayName(providers: readonly string[] | null | undefined): boolean {
  return providers?.some(provider => provider !== 'GUEST') ?? false
}

/** 無照片時顯示名稱的第一個 Unicode 字元；沒有名稱則交給 UI 顯示 icon。 */
export function profileInitial(displayName: string | null | undefined): string | null {
  const name = displayName?.trim()
  return name ? [...name][0] ?? null : null
}
