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

/** 無照片時顯示名稱的第一個 Unicode 字元；沒有名稱則交給 UI 顯示 icon。 */
export function profileInitial(displayName: string | null | undefined): string | null {
  const name = displayName?.trim()
  return name ? [...name][0] ?? null : null
}
