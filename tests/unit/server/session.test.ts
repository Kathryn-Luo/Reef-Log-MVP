import { describe, expect, it } from 'vitest'
import {
  SESSION_MAX_AGE_SECONDS,
  buildSessionPayload,
  readSessionPayload,
} from '../../../server/utils/session'

// 密封 cookie session 的「內容規則」（issue #64 / Epic #47 第 2 節）。
//
// 這個模組刻意只負責 payload 的產生與驗讀，不碰密封（seal / unseal）本身：
// 密封要靠 `nuxt-auth-utils`，而該套件尚未安裝（見 PR 說明）。把規則與加密拆開的
// 好處是規則本身測得起來——過期判定、欄位形狀這些正確性問題全在這一層。

describe('buildSessionPayload', () => {
  // Story ①「And 發出密封 cookie，內容只有 { userId, exp }」
  it('內容只有 userId 與 exp 兩個欄位', () => {
    const payload = buildSessionPayload('user-1', new Date('2026-07-30T00:00:00.000Z'))

    expect(Object.keys(payload).sort()).toEqual(['exp', 'userId'])
    expect(payload.userId).toBe('user-1')
  })

  // 不放 email / displayName：那些是會變的個人資料，放進密封 cookie 等於在使用者
  // 手上留一份改不掉的舊值，直到 cookie 過期為止。要用時以 userId 查。
  it('不夾帶 email、displayName 等個人資料', () => {
    const payload = buildSessionPayload('user-1', new Date('2026-07-30T00:00:00.000Z')) as Record<string, unknown>

    expect(payload.email).toBeUndefined()
    expect(payload.displayName).toBeUndefined()
  })

  it('exp 為「現在 + 有效期」的 Unix 秒數', () => {
    const now = new Date('2026-07-30T00:00:00.000Z')

    expect(buildSessionPayload('user-1', now).exp)
      .toBe(Math.floor(now.getTime() / 1000) + SESSION_MAX_AGE_SECONDS)
  })

  it('有效期可覆寫（縮短有效期是「無法提前撤銷」的緩解手段）', () => {
    const now = new Date('2026-07-30T00:00:00.000Z')

    expect(buildSessionPayload('user-1', now, 60).exp)
      .toBe(Math.floor(now.getTime() / 1000) + 60)
  })
})

describe('readSessionPayload', () => {
  const now = new Date('2026-07-30T00:00:00.000Z')

  it('未過期的 payload 原樣讀回', () => {
    const payload = buildSessionPayload('user-1', now)

    expect(readSessionPayload(payload, now)).toEqual(payload)
  })

  // Story ④「Given 我沒有 cookie，或 cookie 已過期／簽章驗不過 → 取到 null」
  it('沒有 cookie（undefined / null）時回傳 null', () => {
    expect(readSessionPayload(undefined, now)).toBeNull()
    expect(readSessionPayload(null, now)).toBeNull()
  })

  // Story ⑤「登出 → cookie 被清除，之後的請求一律視為未登入」
  // 清除 cookie 之後，server 這一側看到的就是「沒有 cookie」這一條路徑。
  it('登出清掉 cookie 之後讀不到任何 session', () => {
    expect(readSessionPayload(undefined, now)).toBeNull()
  })

  it('exp 已過（含剛好到期）時回傳 null', () => {
    const expired = buildSessionPayload('user-1', new Date('2026-07-01T00:00:00.000Z'), 60)

    expect(readSessionPayload(expired, now)).toBeNull()
    expect(readSessionPayload({ userId: 'user-1', exp: Math.floor(now.getTime() / 1000) }, now)).toBeNull()
  })

  // 簽章驗不過時 unseal 端會給不出 payload（→ undefined，上一條測過）；
  // 這裡守的是「解得開、但形狀不對」——例如換過 payload 版本、或被塞了半個物件。
  it('形狀不對的 payload 回傳 null', () => {
    expect(readSessionPayload({}, now)).toBeNull()
    expect(readSessionPayload({ userId: 'user-1' }, now)).toBeNull()
    expect(readSessionPayload({ exp: 99999999999 }, now)).toBeNull()
    expect(readSessionPayload({ userId: '', exp: 99999999999 }, now)).toBeNull()
    expect(readSessionPayload({ userId: 42, exp: 99999999999 }, now)).toBeNull()
    expect(readSessionPayload({ userId: 'user-1', exp: 'soon' }, now)).toBeNull()
    expect(readSessionPayload('user-1', now)).toBeNull()
  })
})
