import { describe, expect, it } from 'vitest'
import { describeMoveFailure, formatTankSpec, tankDotColor } from '#shared/utils/creatureMove'
import type { TankOption } from '#shared/types/home'

// 換缸失敗時畫面要說的那一句（issue #120 的 3d）。
//
// 三件事由狀態碼決定，而且三件必須一起決定，不然畫面會出現「主鈕說重試、
// 清單裡卻已經沒有那個目標」這種互相矛盾的組合：
//   ① 內文——指名目標缸、說明原因、明說後果
//   ② 主要動作——400 / 404 是「這個目標不行」，只能換一個；其餘是「這次沒送成」，重送有意義
//   ③ 那個目標缸要不要從清單移除——只有 404，因為它真的已經不在了

const CONTEXT = {
  creatureName: '火焰仙',
  currentTankName: '主缸',
  targetTankName: '珊瑚缸',
}

function tank(overrides: Partial<TankOption> = {}): TankOption {
  return {
    id: 'tank-1',
    name: '主缸',
    sizeSpec: '4 尺',
    volumeLiters: 420,
    setupType: null,
    colorHex: '#2dd4bf',
    ...overrides,
  }
}

// 所在缸那一列與 sheet 上每一項共用的「4 尺 · 420 L」
describe('formatTankSpec', () => {
  it('尺寸與水量之間放分隔點', () => {
    expect(formatTankSpec(tank())).toBe('4 尺 · 420 L')
  })

  // 兩個欄位都是選填（見 schema.prisma 的 Tank），缺一個時不留下孤零零的分隔點
  it('只有尺寸時不留下分隔點', () => {
    expect(formatTankSpec(tank({ volumeLiters: null }))).toBe('4 尺')
  })

  it('只有水量時不留下分隔點', () => {
    expect(formatTankSpec(tank({ sizeSpec: null }))).toBe('420 L')
  })

  it('兩個都沒有時是空字串', () => {
    expect(formatTankSpec(tank({ sizeSpec: null, volumeLiters: null }))).toBe('')
  })
})

describe('tankDotColor', () => {
  it('照缸自己的代表色', () => {
    expect(tankDotColor(tank({ colorHex: '#a78bfa' }))).toBe('#a78bfa')
  })

  // 沒設色、或存進去的值不是色碼時退回主色，而不是畫出一塊瀏覽器猜出來的顏色
  it.each([[null], ['not-a-color'], ['']])('色碼是 %s 時退回主色', (colorHex) => {
    expect(tankDotColor(tank({ colorHex }))).toBe('#2dd4bf')
  })
})

describe('describeMoveFailure — 404 目標缸不存在', () => {
  // Then sheet 上出現錯誤卡片，說明原因並指名該目標缸
  // And  訊息明說後果：生物仍在原本的缸，沒有被移動
  it('指名目標缸、說明原因，並明說生物仍在原本的缸', () => {
    const failure = describeMoveFailure(404, CONTEXT)

    expect(failure.message).toContain('珊瑚缸')
    expect(failure.message).toContain('404')
    expect(failure.message).toContain('火焰仙')
    expect(failure.message).toContain('主缸')
    expect(failure.message).toContain('未被移動')
  })

  // Then 主要動作是「選其他缸」，畫面上不出現「重試」
  it('主要動作是回到選擇狀態，不是重試', () => {
    expect(describeMoveFailure(404, CONTEXT).action).toBe('choose-other')
  })

  // 3d：404 的那個目標缸從清單移除（它已經不存在了）
  it('要求把該目標缸從清單移除', () => {
    expect(describeMoveFailure(404, CONTEXT).dropTarget).toBe(true)
  })
})

describe('describeMoveFailure — 400 這個目標不行', () => {
  it('同樣指名目標缸並明說後果', () => {
    const failure = describeMoveFailure(400, CONTEXT)

    expect(failure.message).toContain('珊瑚缸')
    expect(failure.message).toContain('400')
    expect(failure.message).toContain('未被移動')
  })

  // 400 是「來源與目標相同」，重送一次只會再收到一次 400
  it('主要動作也是回到選擇狀態', () => {
    expect(describeMoveFailure(400, CONTEXT).action).toBe('choose-other')
  })

  // 400 的目標缸仍然存在（它就是目前所在的那一個），沒有理由從清單拿掉
  it('不要求把該目標缸從清單移除', () => {
    expect(describeMoveFailure(400, CONTEXT).dropTarget).toBe(false)
  })
})

describe('describeMoveFailure — 其他失敗', () => {
  // 離線、5xx、function 掛掉：那是「這一次沒送成」，重送有意義
  it.each([[500], [502], [null]])('狀態碼 %s 的主要動作是重試', (status) => {
    const failure = describeMoveFailure(status, CONTEXT)

    expect(failure.action).toBe('retry')
    expect(failure.dropTarget).toBe(false)
  })

  it('內文同樣指名目標缸並明說生物仍在原本的缸', () => {
    const failure = describeMoveFailure(null, CONTEXT)

    expect(failure.message).toContain('珊瑚缸')
    expect(failure.message).toContain('主缸')
    expect(failure.message).toContain('未被移動')
  })
})
