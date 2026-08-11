// @vitest-environment node

import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import {
  CREATURE_NOT_FOUND,
  NOT_SIGNED_IN,
  TANK_NOT_FOUND,
  createOwnedCreature,
  updateOwnedCreatureProfile,
} from '../../../server/utils/authorization'

const USER_A = { id: 'user-a' }
const USER_B = { id: 'user-b' }
const NOW = new Date('2026-08-11T12:00:00.000Z')

const VALID_BODY = {
  name: '火焰仙',
  scientificName: 'Centropyge loriculus',
  category: 'FISH',
  subCategory: '神仙',
  addedOn: '2026-08-01',
  price: '1280.50',
  timeZoneOffsetMinutes: -480,
}

const tanks = [
  { id: 'tank-a', userId: USER_A.id, archivedAt: null, name: '主缸' },
  { id: 'tank-b', userId: USER_B.id, archivedAt: null, name: '別人的缸' },
]

const creatures = [
  {
    id: 'creature-a',
    tankId: 'tank-a',
    name: '舊名字',
    scientificName: null,
    category: 'FISH',
    subCategory: null,
    photoUrl: null,
    addedOn: new Date('2026-07-01T00:00:00.000Z'),
    price: null,
    status: 'ALIVE',
    observedSickOn: null,
    ailment: null,
    diedOn: null,
    causeOfDeath: null,
    deathNote: null,
  },
  {
    id: 'creature-sick',
    tankId: 'tank-a',
    name: '生病的魚',
    scientificName: null,
    category: 'FISH',
    subCategory: null,
    photoUrl: null,
    addedOn: new Date('2026-07-01T00:00:00.000Z'),
    price: null,
    status: 'SICK',
    observedSickOn: new Date('2026-08-05T00:00:00.000Z'),
    ailment: '白點',
    diedOn: null,
    causeOfDeath: null,
    deathNote: null,
  },
  {
    id: 'creature-dead',
    tankId: 'tank-a',
    name: '死亡的魚',
    scientificName: null,
    category: 'FISH',
    subCategory: null,
    photoUrl: null,
    addedOn: new Date('2026-07-01T00:00:00.000Z'),
    price: null,
    status: 'DEAD',
    observedSickOn: null,
    ailment: null,
    diedOn: new Date('2026-08-05T00:00:00.000Z'),
    causeOfDeath: 'UNKNOWN',
    deathNote: null,
  },
  {
    id: 'creature-b',
    tankId: 'tank-b',
    name: '別人的魚',
    scientificName: null,
    category: 'FISH',
    subCategory: null,
    photoUrl: null,
    addedOn: new Date('2026-07-01T00:00:00.000Z'),
    price: null,
    status: 'ALIVE',
    observedSickOn: null,
    ailment: null,
    diedOn: null,
    causeOfDeath: null,
    deathNote: null,
  },
]

function recordNotFound() {
  return Object.assign(new Error('Record to update not found.'), { code: 'P2025' })
}

function fakeClient() {
  const tankFor = (id: string | undefined, userId: string | undefined) =>
    tanks.find(tank => tank.id === id && tank.userId === userId && tank.archivedAt === null) ?? null

  const client = {
    tank: {
      findFirst: vi.fn(({ where }: { where: { id: string, userId: string } }) =>
        Promise.resolve(tankFor(where.id, where.userId))),
    },
    creature: {
      findFirst: vi.fn(({ where }: { where: { id: string, tank: { userId: string } } }) => {
        const creature = creatures.find(candidate => candidate.id === where.id)
        const tank = creature ? tankFor(creature.tankId, where.tank.userId) : null

        return Promise.resolve(creature && tank ? { ...creature, tank: { name: tank.name } } : null)
      }),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const tank = tanks.find(candidate => candidate.id === data.tankId)!

        return Promise.resolve({
          ...creatures[0],
          ...data,
          id: 'creature-new',
          status: 'ALIVE',
          tank: { name: tank.name },
        })
      }),
      update: vi.fn(({ where, data }: { where: { id: string, tank: { userId: string } }, data: Record<string, unknown> }) => {
        const creature = creatures.find(candidate => candidate.id === where.id)
        const tank = creature ? tankFor(creature.tankId, where.tank.userId) : null

        if (!creature || !tank) {
          return Promise.reject(recordNotFound())
        }

        return Promise.resolve({ ...creature, ...data, tank: { name: tank.name } })
      }),
    },
  }

  return client as unknown as PrismaClient & typeof client
}

const bodyReader = (body: unknown) => vi.fn().mockResolvedValue(body)

describe('POST /api/tanks/:id/creatures', () => {
  it('未登入時先回 401，不讀 body 也不查詢或寫入', async () => {
    const client = fakeClient()
    const readBody = bodyReader(VALID_BODY)

    await expect(createOwnedCreature(client, null, 'tank-a', readBody, NOW))
      .resolves.toEqual({ ok: false, error: NOT_SIGNED_IN })
    expect(readBody).not.toHaveBeenCalled()
    expect(client.tank.findFirst).not.toHaveBeenCalled()
    expect(client.creature.create).not.toHaveBeenCalled()
  })

  it('別人的缸與不存在的缸回同一個 404，且一次寫入都沒有發生', async () => {
    for (const tankId of ['tank-b', 'missing']) {
      const client = fakeClient()
      const readBody = bodyReader(VALID_BODY)

      await expect(createOwnedCreature(client, USER_A, tankId, readBody, NOW))
        .resolves.toEqual({ ok: false, error: TANK_NOT_FOUND })
      expect(readBody).not.toHaveBeenCalled()
      expect(client.creature.create).not.toHaveBeenCalled()
    }
  })

  it('建立在通過歸屬檢查的缸，status 由 schema 預設成 ALIVE', async () => {
    const client = fakeClient()

    const result = await createOwnedCreature(client, USER_A, 'tank-a', bodyReader(VALID_BODY), NOW)

    expect(result).toMatchObject({
      ok: true,
      value: {
        creature: {
          id: 'creature-new',
          tankId: 'tank-a',
          name: '火焰仙',
          status: 'ALIVE',
          addedOn: '2026-08-01',
          price: 1280.5,
        },
      },
    })
    const createData = client.creature.create.mock.calls[0]![0].data
    expect(createData).not.toHaveProperty('status')
    expect(createData).not.toHaveProperty('photoUrl')
  })

  it('必填欄位不合法時回 400，且一次寫入都沒有發生', async () => {
    const client = fakeClient()
    const result = await createOwnedCreature(client, USER_A, 'tank-a', bodyReader({ ...VALID_BODY, name: '' }), NOW)

    expect(result).toMatchObject({ ok: false, error: { statusCode: 400, data: { message: '請輸入俗名。' } } })
    expect(client.creature.create).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/creatures/:id/profile', () => {
  it('別人的生物與不存在的生物回同一個 404，不讀 body 也不寫入', async () => {
    for (const creatureId of ['creature-b', 'missing']) {
      const client = fakeClient()
      const readBody = bodyReader(VALID_BODY)

      await expect(updateOwnedCreatureProfile(client, USER_A, creatureId, readBody, NOW))
        .resolves.toEqual({ ok: false, error: CREATURE_NOT_FOUND })
      expect(readBody).not.toHaveBeenCalled()
      expect(client.creature.update).not.toHaveBeenCalled()
    }
  })

  it.each(['status', 'diedOn', 'observedSickOn'])('拒絕基本資料以 %s 修改狀態記錄', async (field) => {
    const client = fakeClient()
    const result = await updateOwnedCreatureProfile(
      client,
      USER_A,
      'creature-a',
      bodyReader({ ...VALID_BODY, [field]: 'tampered' }),
      NOW,
    )

    expect(result).toMatchObject({
      ok: false,
      error: { statusCode: 400, data: { message: '基本資料表單不能修改狀態或死亡／生病記錄。' } },
    })
    expect(client.creature.update).not.toHaveBeenCalled()
  })

  it.each([
    ['creature-sick', '發病日'],
    ['creature-dead', '死亡日'],
  ])('拒絕將 %s 的入缸日改到既有%s之後', async (creatureId, dateLabel) => {
    const client = fakeClient()
    const result = await updateOwnedCreatureProfile(
      client,
      USER_A,
      creatureId,
      bodyReader({ ...VALID_BODY, addedOn: '2026-08-06' }),
      NOW,
    )

    expect(result).toMatchObject({
      ok: false,
      error: { statusCode: 400, data: { message: `入缸日不能晚於${dateLabel}。` } },
    })
    expect(client.creature.update).not.toHaveBeenCalled()
  })

  it('只更新基本資料並回傳正規化後的內容', async () => {
    const client = fakeClient()
    const result = await updateOwnedCreatureProfile(client, USER_A, 'creature-a', bodyReader(VALID_BODY), NOW)

    expect(result).toMatchObject({
      ok: true,
      value: { creature: { id: 'creature-a', name: '火焰仙', status: 'ALIVE', price: 1280.5 } },
    })
    const update = client.creature.update.mock.calls[0]![0]
    expect(update.where).toEqual({
      id: 'creature-a',
      tank: { userId: 'user-a', archivedAt: null },
      AND: [
        { OR: [{ observedSickOn: null }, { observedSickOn: { gte: new Date('2026-08-01T00:00:00.000Z') } }] },
        { OR: [{ diedOn: null }, { diedOn: { gte: new Date('2026-08-01T00:00:00.000Z') } }] },
      ],
    })
    expect(update.data).toEqual({
      name: '火焰仙',
      scientificName: 'Centropyge loriculus',
      category: 'FISH',
      subCategory: '神仙',
      addedOn: new Date('2026-08-01T00:00:00.000Z'),
      price: 1280.5,
    })
  })
})
