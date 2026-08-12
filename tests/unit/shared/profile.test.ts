// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { DISPLAY_NAME_MAX_LENGTH, ownsDisplayName, parseDisplayName, profileInitial } from '../../../shared/utils/profile'

describe('parseDisplayName', () => {
  it('移除名稱前後空白', () => {
    expect(parseDisplayName({ displayName: '  小魚缸管理員  ' }))
      .toEqual({ ok: true, value: '小魚缸管理員' })
  })

  it.each([
    undefined,
    {},
    { displayName: '' },
    { displayName: '   ' },
  ])('缺少名稱或只有空白時拒絕：%j', (input) => {
    expect(parseDisplayName(input)).toEqual({ ok: false, message: '請輸入顯示名稱。' })
  })

  it('30 個字可通過，31 個字會被拒絕', () => {
    expect(parseDisplayName({ displayName: '魚'.repeat(DISPLAY_NAME_MAX_LENGTH) }).ok).toBe(true)
    expect(parseDisplayName({ displayName: '魚'.repeat(DISPLAY_NAME_MAX_LENGTH + 1) }))
      .toEqual({ ok: false, message: '顯示名稱請控制在 30 個字以內。' })
  })

  it('以 Unicode 字元計算 emoji，不把代理對拆成兩個字', () => {
    expect(parseDisplayName({ displayName: '🐠'.repeat(DISPLAY_NAME_MAX_LENGTH) }).ok).toBe(true)
  })

  it.each(['魚\n缸', '魚\r缸', '魚\t缸', `魚${String.fromCharCode(0)}缸`])(
    '含控制字元時拒絕：%j',
    (displayName) => {
      expect(parseDisplayName({ displayName }))
        .toEqual({ ok: false, message: '顯示名稱不能包含換行或控制字元。' })
    },
  )
})

describe('profileInitial', () => {
  it.each([
    [' 訪客 ', '訪'],
    ['🐠魚缸', '🐠'],
    ['', null],
    ['   ', null],
    [null, null],
  ])('從顯示名稱 %j 取得首字 %j', (displayName, expected) => {
    expect(profileInitial(displayName)).toBe(expected)
  })
})

// 「這個名字是不是他自己的」——訪客不是，所以既不能改名（#171），也不用首字頭像
describe('ownsDisplayName', () => {
  it.each([
    [['GOOGLE'], true],
    [['GUEST', 'GOOGLE'], true],
    [['GOOGLE', 'GUEST'], true],
    [['GUEST'], false],
    [[], false],
  ])('providers %j → %j', (providers, expected) => {
    expect(ownsDisplayName(providers)).toBe(expected)
  })

  it('providers 缺漏時當成沒有自己的名字，不要當成有', () => {
    expect(ownsDisplayName(null)).toBe(false)
    expect(ownsDisplayName(undefined)).toBe(false)
  })
})
