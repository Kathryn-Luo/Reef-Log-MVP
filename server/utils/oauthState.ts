import { randomBytes, timingSafeEqual } from 'node:crypto'

export const OAUTH_STATE_COOKIE = 'reef-oauth-state'

/** 256 bits of entropy, encoded without characters that need URL escaping. */
export function createOAuthState(): string {
  return randomBytes(32).toString('base64url')
}

/** Reject missing/empty values and compare equal-length states in constant time. */
export function verifyOAuthState(queryState: unknown, cookieState: unknown): boolean {
  if (typeof queryState !== 'string' || typeof cookieState !== 'string'
    || queryState.length === 0 || cookieState.length === 0) {
    return false
  }

  const queryBuffer = Buffer.from(queryState)
  const cookieBuffer = Buffer.from(cookieState)

  return queryBuffer.length === cookieBuffer.length
    && timingSafeEqual(queryBuffer, cookieBuffer)
}
