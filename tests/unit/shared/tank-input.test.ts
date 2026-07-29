import { describe, expect, it } from 'vitest'
import { TANK_COLOR_OPTIONS, parseTankInput } from '#shared/utils/tankForm'

// Given 我在建立缸的表單 / When 我填入缸名（必填）與尺寸 / 水量 / 飼養型態 / 代表色（選填）並送出
// Then 建立一個屬於我的 Tank
//
// 表單與 POST /api/tanks 共用這一支：欄位規則只寫一次，前端擋掉的與後端擋掉的必然一致。

describe('parseTankInput — 缸名（必填）', () => {
  it('接受缸名並去掉前後空白', () => {
    const result = parseTankInput({ name: '  主缸  ' })

    expect(result).toEqual({
      ok: true,
      value: {
        name: '主缸',
        sizeSpec: null,
        volumeLiters: null,
        setupType: null,
        colorHex: null,
      },
    })
  })

  it('缸名沒填時不通過', () => {
    expect(parseTankInput({ name: '' }).ok).toBe(false)
    expect(parseTankInput({ name: '   ' }).ok).toBe(false)
    expect(parseTankInput({}).ok).toBe(false)
    expect(parseTankInput(null).ok).toBe(false)
  })

  it('缸名沒填時說明的是缸名這一項', () => {
    const result = parseTankInput({ name: '' })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('缸名')
  })

  it('缸名過長時不通過', () => {
    expect(parseTankInput({ name: 'a'.repeat(41) }).ok).toBe(false)
    expect(parseTankInput({ name: 'a'.repeat(40) }).ok).toBe(true)
  })
})

describe('parseTankInput — 選填欄位', () => {
  it('填齊時原樣帶出（水量轉成數字、代表色轉小寫）', () => {
    const result = parseTankInput({
      name: '主缸',
      sizeSpec: ' 4 尺 ',
      volumeLiters: '420',
      setupType: ' SPS MIXED ',
      colorHex: '#2DD4BF',
    })

    expect(result).toEqual({
      ok: true,
      value: {
        name: '主缸',
        sizeSpec: '4 尺',
        volumeLiters: 420,
        setupType: 'SPS MIXED',
        colorHex: '#2dd4bf',
      },
    })
  })

  // 選填欄位留白時存 null，而不是空字串——頁首的「主缸 · 4 尺」靠 falsy 判斷是否要加分隔點
  it('留白的選填欄位一律轉成 null', () => {
    const result = parseTankInput({
      name: '檢疫缸',
      sizeSpec: '  ',
      volumeLiters: '',
      setupType: '',
      colorHex: '',
    })

    expect(result).toEqual({
      ok: true,
      value: {
        name: '檢疫缸',
        sizeSpec: null,
        volumeLiters: null,
        setupType: null,
        colorHex: null,
      },
    })
  })

  it('水量也接受數字型別（type=number 的輸入框會直接給 number）', () => {
    const result = parseTankInput({ name: '主缸', volumeLiters: 420 })

    expect(result.ok === true && result.value.volumeLiters).toBe(420)
  })

  it('水量不是正整數時不通過', () => {
    expect(parseTankInput({ name: '主缸', volumeLiters: '0' }).ok).toBe(false)
    expect(parseTankInput({ name: '主缸', volumeLiters: '-5' }).ok).toBe(false)
    expect(parseTankInput({ name: '主缸', volumeLiters: '42.5' }).ok).toBe(false)
    expect(parseTankInput({ name: '主缸', volumeLiters: '四百二' }).ok).toBe(false)
  })

  it('代表色不是 #RRGGBB 時不通過', () => {
    expect(parseTankInput({ name: '主缸', colorHex: 'teal' }).ok).toBe(false)
    expect(parseTankInput({ name: '主缸', colorHex: '#2dd' }).ok).toBe(false)
    expect(parseTankInput({ name: '主缸', colorHex: '#2dd4bf' }).ok).toBe(true)
  })
})

describe('TANK_COLOR_OPTIONS', () => {
  // schema.prisma 的 Tank.colorHex 註解寫明存 #RRGGBB，色票本身也得守同一個格式
  it('每個色票都是合法的 #RRGGBB 且不重複', () => {
    const hexes = TANK_COLOR_OPTIONS.map(option => option.hex)

    expect(hexes.length).toBeGreaterThan(0)
    expect(new Set(hexes).size).toBe(hexes.length)
    for (const option of TANK_COLOR_OPTIONS) {
      expect(option.hex).toMatch(/^#[0-9a-f]{6}$/)
      expect(parseTankInput({ name: '主缸', colorHex: option.hex }).ok).toBe(true)
    }
  })
})
