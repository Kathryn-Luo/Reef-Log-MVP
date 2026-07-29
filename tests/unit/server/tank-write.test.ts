import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTank } from '../../../server/utils/tankWrite'
import type { CreateTankInput } from '#shared/types/tank'

// 這個 job 連不到資料庫，Prisma Client 一律以假物件替身餵入
// （與 server/utils/homeData.ts、currentContext.ts 同一個作法）
function fakeClient(tankCount = 0) {
  const client = {
    tank: {
      count: vi.fn().mockResolvedValue(tankCount),
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'tank-new',
          archivedAt: null,
          startedOn: null,
          createdAt: new Date('2026-07-29T00:00:00.000Z'),
          updatedAt: new Date('2026-07-29T00:00:00.000Z'),
          ...data,
        }),
      ),
    },
  }

  return client as unknown as PrismaClient & typeof client
}

const MAIN_TANK_INPUT: CreateTankInput = {
  name: '主缸',
  sizeSpec: '4 尺',
  volumeLiters: 420,
  setupType: 'SPS MIXED',
  colorHex: '#2dd4bf',
  startedOn: '2025-11-12',
}

describe('createTank', () => {
  // Then 建立一個屬於我的 Tank
  it('把表單欄位寫進當前使用者名下的缸', async () => {
    const client = fakeClient()

    await createTank(client, 'user-1', MAIN_TANK_INPUT)

    expect(client.tank.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        name: '主缸',
        sizeSpec: '4 尺',
        volumeLiters: 420,
        setupType: 'SPS MIXED',
        colorHex: '#2dd4bf',
        // schema 的 Tank.startedOn 是 @db.Date，存 UTC 當天的零時，
        // 免得使用者在 UTC+8 選 11/12 卻被記成 11/11
        startedOn: new Date('2025-11-12T00:00:00.000Z'),
        displayOrder: 0,
      },
    })
  })

  // Then displayOrder 為我目前缸數
  it('displayOrder 取我目前的缸數，新缸排在最後', async () => {
    const client = fakeClient(3)

    await createTank(client, 'user-1', MAIN_TANK_INPUT)

    expect(client.tank.count).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(client.tank.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ displayOrder: 3 }),
    })
  })

  it('回傳缸切換選單與頁首需要的欄位', async () => {
    const client = fakeClient(1)

    await expect(createTank(client, 'user-1', MAIN_TANK_INPUT)).resolves.toEqual({
      id: 'tank-new',
      name: '主缸',
      sizeSpec: '4 尺',
      volumeLiters: 420,
      setupType: 'SPS MIXED',
      colorHex: '#2dd4bf',
    })
  })

  it('選填欄位留白時寫入 null', async () => {
    const client = fakeClient()

    await createTank(client, 'user-1', {
      name: '檢疫缸',
      sizeSpec: null,
      volumeLiters: null,
      setupType: null,
      colorHex: null,
      startedOn: null,
    })

    expect(client.tank.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        name: '檢疫缸',
        sizeSpec: null,
        volumeLiters: null,
        setupType: null,
        colorHex: null,
        startedOn: null,
        displayOrder: 0,
      },
    })
  })
})
