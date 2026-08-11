// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  CREATURE_PRICE_MAX,
  parseCreatureProfileInput,
} from '../../../shared/utils/creatureForm'

const NOW = new Date('2026-08-11T12:00:00.000Z')

const VALID_INPUT = {
  name: ' 火焰仙 ',
  scientificName: ' Centropyge loriculus ',
  category: 'FISH',
  subCategory: ' 神仙 ',
  addedOn: '2026-08-11',
  price: '1280.50',
  timeZoneOffsetMinutes: -480,
}

describe('parseCreatureProfileInput', () => {
  it.each([
    ['俗名', { name: '  ' }, '請輸入俗名。'],
    ['分類', { category: '' }, '請選擇分類。'],
    ['入缸日', { addedOn: '' }, '請填入缸日。'],
  ])('%s 是必填欄位', (_label, override, message) => {
    expect(parseCreatureProfileInput({ ...VALID_INPUT, ...override }, NOW))
      .toEqual({ ok: false, message })
  })

  it('正規化文字與價格，選填文字留白時送出 null', () => {
    expect(parseCreatureProfileInput({
      ...VALID_INPUT,
      scientificName: ' ',
      subCategory: '',
    }, NOW)).toEqual({
      ok: true,
      value: {
        name: '火焰仙',
        scientificName: null,
        category: 'FISH',
        subCategory: null,
        addedOn: '2026-08-11',
        price: 1280.5,
      },
    })
  })

  it.each(['FISH', 'CORAL', 'OTHER'])('接受 schema 已定案的分類 %s', (category) => {
    expect(parseCreatureProfileInput({ ...VALID_INPUT, category }, NOW)).toMatchObject({
      ok: true,
      value: { category },
    })
  })

  it('拒絕不在 schema enum 裡的分類', () => {
    expect(parseCreatureProfileInput({ ...VALID_INPUT, category: 'INVERTEBRATE' }, NOW))
      .toEqual({ ok: false, message: '請選擇分類。' })
  })

  it.each(['2026/08/11', '2026-02-30', 'not-a-date'])('拒絕不合法的入缸日 %s', (addedOn) => {
    expect(parseCreatureProfileInput({ ...VALID_INPUT, addedOn }, NOW))
      .toEqual({ ok: false, message: '入缸日請選擇一個實際存在的日期。' })
  })

  it('拒絕未來的入缸日，但接受今天', () => {
    expect(parseCreatureProfileInput({ ...VALID_INPUT, addedOn: '2026-08-12' }, NOW))
      .toEqual({ ok: false, message: '入缸日不能晚於今天。' })
    expect(parseCreatureProfileInput({ ...VALID_INPUT, addedOn: '2026-08-11' }, NOW).ok).toBe(true)
  })

  it('以使用者時區判斷今天，台灣午夜後可登錄當地今天', () => {
    const taipeiMidnight = new Date('2026-08-11T16:30:00.000Z')

    expect(parseCreatureProfileInput({ ...VALID_INPUT, addedOn: '2026-08-12' }, taipeiMidnight).ok).toBe(true)
    expect(parseCreatureProfileInput({ ...VALID_INPUT, addedOn: '2026-08-12', timeZoneOffsetMinutes: 0 }, taipeiMidnight))
      .toEqual({ ok: false, message: '入缸日不能晚於今天。' })
  })

  it.each([undefined, 'bad', -841, 721, 1.5])('拒絕不合法的時區 offset：%s', (timeZoneOffsetMinutes) => {
    expect(parseCreatureProfileInput({ ...VALID_INPUT, timeZoneOffsetMinutes }, NOW))
      .toEqual({ ok: false, message: '時區資訊不正確，請重新整理後再試。' })
  })

  it.each([
    [{ observedSickOn: '2026-08-05' }, '入缸日不能晚於發病日。'],
    [{ diedOn: '2026-08-05' }, '入缸日不能晚於死亡日。'],
  ])('入缸日不得越過既有病亡日期', (dateLimits, message) => {
    expect(parseCreatureProfileInput({ ...VALID_INPUT, addedOn: '2026-08-06' }, NOW, dateLimits))
      .toEqual({ ok: false, message })
    expect(parseCreatureProfileInput({ ...VALID_INPUT, addedOn: '2026-08-05' }, NOW, dateLimits).ok).toBe(true)
  })

  it('價格留白與填 0 是不同的值', () => {
    expect(parseCreatureProfileInput({ ...VALID_INPUT, price: ' ' }, NOW)).toMatchObject({
      ok: true,
      value: { price: null },
    })
    expect(parseCreatureProfileInput({ ...VALID_INPUT, price: '0' }, NOW)).toMatchObject({
      ok: true,
      value: { price: 0 },
    })
  })

  it.each(['-1', '12.345', '1e3', '免費', `${CREATURE_PRICE_MAX + 0.01}`])(
    '拒絕負數、超過兩位小數、指數、非數字或超過 schema 上限的價格 %s',
    (price) => {
      expect(parseCreatureProfileInput({ ...VALID_INPUT, price }, NOW))
        .toEqual({ ok: false, message: '購入價請填 0 到 99999999.99 之間的數字，且最多兩位小數。' })
    },
  )

  it('基本資料輸入不接受狀態、死亡或生病記錄欄位', () => {
    for (const key of ['status', 'observedSickOn', 'ailment', 'diedOn', 'causeOfDeath', 'deathNote']) {
      expect(parseCreatureProfileInput({ ...VALID_INPUT, [key]: 'tampered' }, NOW))
        .toEqual({ ok: false, message: '基本資料表單不能修改狀態或死亡／生病記錄。' })
    }
  })
})
