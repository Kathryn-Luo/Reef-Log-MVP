// @vitest-environment node
// 純函式測試，不碰 Vue 元件、Nuxt composable 或 DOM；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  CREATURE_NOT_FOUND,
  MISSING_CREATURE_ID,
  MISSING_TANK_ID,
  NOT_SIGNED_IN,
  TANK_NOT_FOUND,
  applyCreatureStatus,
  createOwnedTank,
  moveOwnedCreature,
  resolveCreatureDetail,
  resolveTankCreatures,
  resolveTankHome,
  resolveTankOptions,
} from '../../../server/utils/authorization'

// 資料歸屬的伺服器邊界（issue #68）。
//
// 這一支測的是「A 的身分打 B 的 id 會拿到什麼」，所以假 client 不能只是
// 「findFirst 一律回這個值」——那樣測到的只是 mock 自己。這裡的替身照著
// 各函式實際下的 where 條件過濾記憶體中的列，A 拿不到 B 的資料才是被
// 查詢條件擋下來的，不是被夾具安排好的。
//
// 這個 job 連不到資料庫，Prisma Client 一律以假物件替身餵入
// （函式簽章刻意收 client 參數，與 server/utils/homeData.ts 同一個作法）。

const USER_A = { id: 'user-a' }
const USER_B = { id: 'user-b' }

interface TankRow {
  id: string
  userId: string
  archivedAt: Date | null
  displayOrder: number
}

interface CreatureRow {
  id: string
  tankId: string
}

/** A 有一個未封存的缸與一個已封存的缸；B 有一個未封存的缸，各自有一隻生物 */
const TANKS: TankRow[] = [
  { id: 'tank-a1', userId: USER_A.id, archivedAt: null, displayOrder: 0 },
  { id: 'tank-a2', userId: USER_A.id, archivedAt: null, displayOrder: 1 },
  { id: 'tank-a-archived', userId: USER_A.id, archivedAt: new Date('2026-01-01T00:00:00.000Z'), displayOrder: 1 },
  { id: 'tank-b1', userId: USER_B.id, archivedAt: null, displayOrder: 0 },
]

const CREATURES: CreatureRow[] = [
  { id: 'creature-a1', tankId: 'tank-a1' },
  // A 自己的生物，但缸已封存——getCreatureDetail 的 archivedAt 那一半要有東西可測，
  // 否則「已封存的缸不該從詳情頁繞進去」只有註解，沒有行為驗證
  { id: 'creature-a-archived', tankId: 'tank-a-archived' },
  { id: 'creature-b1', tankId: 'tank-b1' },
]

/** 缸的其餘欄位；歸屬檢查用不到，但 toTankOption / getTankHome 會讀 */
function tankRow(row: TankRow) {
  return {
    ...row,
    name: `缸 ${row.id}`,
    sizeSpec: null,
    volumeLiters: null,
    setupType: null,
    colorHex: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }
}

/** 生物的其餘欄位；@db.Date 都給實際的 Date，轉換才走得完 */
function creatureRow(row: CreatureRow) {
  return {
    ...row,
    name: `生物 ${row.id}`,
    scientificName: null,
    category: 'FISH',
    subCategory: null,
    status: 'ALIVE',
    photoUrl: null,
    addedOn: new Date('2026-05-01T00:00:00.000Z'),
    ailment: null,
    observedSickOn: null,
    diedOn: null,
    causeOfDeath: null,
    deathNote: null,
  }
}

/** Prisma 在 `where` 一列都沒對上時丟的錯誤 */
function recordNotFound() {
  return Object.assign(new Error('Record to update not found.'), { code: 'P2025' })
}

/** PostgreSQL serializable transaction 的可重試衝突，Prisma 以 P2034 表示。 */
function transactionConflict() {
  return Object.assign(new Error('Transaction failed due to a write conflict or a deadlock.'), { code: 'P2034' })
}

function fakeClient() {
  const tanks = TANKS.map(tankRow)
  const creatures = CREATURES.map(creatureRow)

  const ownedTank = (where: { id?: string, userId?: string, archivedAt?: Date | null }) =>
    tanks.find(tank =>
      (where.id === undefined || tank.id === where.id)
      && (where.userId === undefined || tank.userId === where.userId)
      && (where.archivedAt === undefined || tank.archivedAt === where.archivedAt)) ?? null

  const client = {
    tank: {
      findFirst: vi.fn(({ where }: { where: Parameters<typeof ownedTank>[0] }) => Promise.resolve(ownedTank(where))),
      findMany: vi.fn(({ where }: { where: { userId: string, archivedAt: null } }) => Promise.resolve(
        tanks.filter(tank => tank.userId === where.userId && tank.archivedAt === where.archivedAt),
      )),
      count: vi.fn(({ where }: { where: { userId: string } }) => Promise.resolve(
        tanks.filter(tank => tank.userId === where.userId).length,
      )),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({
        ...tankRow({ id: 'tank-new', userId: 'unset', archivedAt: null, displayOrder: 0 }),
        ...data,
      })),
    },
    creature: {
      // where: { id, tank: { userId, archivedAt: null } }——歸屬要透過缸才看得到
      findFirst: vi.fn(({ where }: { where: { id: string, tank: { userId: string, archivedAt: null } } }) => {
        const creature = creatures.find(candidate => candidate.id === where.id)
        const tank = creature
          ? ownedTank({ id: creature.tankId, ...where.tank })
          : null

        return Promise.resolve(tank ? creature : null)
      }),
      findMany: vi.fn(({ where }: { where: { tankId: string } }) => Promise.resolve(
        creatures.filter(creature => creature.tankId === where.tankId),
      )),
      // where 也帶歸屬條件（見 updateCreatureStatus）：對不上任何一列時
      // Prisma 丟的是 P2025，替身照做，否則「寫入時歸屬已經不成立」就沒得測
      update: vi.fn(({ where, data }: { where: { id: string, tank?: { userId: string, archivedAt: null } }, data: Record<string, unknown> }) => {
        const creature = creatures.find(candidate => candidate.id === where.id)
        const tank = creature ? ownedTank({ id: creature.tankId, ...where.tank }) : null

        return creature && tank
          ? Promise.resolve({ ...creature, ...data })
          : Promise.reject(recordNotFound())
      }),
    },
    waterLog: { findMany: vi.fn().mockResolvedValue([]) },
    waterParameterTarget: { findMany: vi.fn().mockResolvedValue([]) },
  }

  Object.assign(client, {
    $transaction: vi.fn((operation: (transaction: typeof client) => unknown) => operation(client)),
  })

  return client as unknown as PrismaClient & typeof client
}

/** 「這次請求完全沒有碰到缸底下的任何內容」——擋下來之後不該有任何資料被讀出來 */
function expectNoTankContentRead(client: ReturnType<typeof fakeClient>) {
  expect(client.waterLog.findMany).not.toHaveBeenCalled()
  expect(client.waterParameterTarget.findMany).not.toHaveBeenCalled()
  expect(client.creature.findMany).not.toHaveBeenCalled()
}

/** 「未登入的判定沒有對資料庫發出任何查詢」——與 #64 的密封 cookie 取捨一致 */
function expectNoQuery(client: ReturnType<typeof fakeClient>) {
  expect(client.tank.findFirst).not.toHaveBeenCalled()
  expect(client.tank.findMany).not.toHaveBeenCalled()
  expect(client.tank.count).not.toHaveBeenCalled()
  expect(client.tank.create).not.toHaveBeenCalled()
  expect(client.creature.findFirst).not.toHaveBeenCalled()
  expect(client.creature.update).not.toHaveBeenCalled()
  expectNoTankContentRead(client)
}

/** 存活狀態的合法 PATCH 內容，用來確認「被擋下來時連解析都不會生效」 */
const ALIVE_BODY = { status: 'ALIVE' }

/**
 * 兩支寫入 API 的 body 一律以 thunk 餵入，因為 handler 那邊也是這樣傳的。
 *
 * 真正的 `readBody(event)` 對畸形 JSON 會直接 throw 400，所以「什麼時候呼叫它」
 * 決定了未登入的人拿到 401 還是 400。延後到身分／歸屬檢查之後才呼叫，被擋下來的
 * 請求就連 body 都不會讀——這也是 #68 之前 PATCH 的既有行為。
 */
function bodyThunk(value: unknown) {
  return vi.fn(() => Promise.resolve(value))
}

// Given 我以 A 帳號登入、B 有一個缸
// When  我對 GET /api/tanks/<B 的 tankId>/home 發出請求
// Then  回傳 404，不含 B 的任何資料
describe('GET /api/tanks/:id/home 的歸屬檢查', () => {
  it('A 打 B 的 tankId 回 404', async () => {
    const client = fakeClient()

    await expect(resolveTankHome(client, USER_A, 'tank-b1'))
      .resolves.toEqual({ ok: false, error: TANK_NOT_FOUND })
  })

  // 「回 404」與「沒讀到資料」是兩件事：先查完再決定要不要回答，資料就已經離開資料庫了
  it('被擋下來時完全沒有讀取 B 缸底下的內容', async () => {
    const client = fakeClient()

    await resolveTankHome(client, USER_A, 'tank-b1')

    expectNoTankContentRead(client)
  })

  it('A 打自己的 tankId 正常拿到資料', async () => {
    const client = fakeClient()
    const result = await resolveTankHome(client, USER_A, 'tank-a1')

    expect(result.ok).toBe(true)
    expect(client.creature.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tankId: 'tank-a1' } }),
    )
  })

  // 已封存的缸不出現在任何清單裡，就不該從網址繞進去（listTankOptions 的既有條件）
  it('自己已封存的缸同樣回 404', async () => {
    await expect(resolveTankHome(fakeClient(), USER_A, 'tank-a-archived'))
      .resolves.toEqual({ ok: false, error: TANK_NOT_FOUND })
  })

  // Given 我沒有登入 / Then 回傳 401，不回傳任何資料
  it('未登入時回 401，而且一次查詢都不發出', async () => {
    const client = fakeClient()

    await expect(resolveTankHome(client, null, 'tank-a1'))
      .resolves.toEqual({ ok: false, error: NOT_SIGNED_IN })
    expectNoQuery(client)
  })
})

// Given 我以 A 帳號登入
// When  我對 GET /api/tanks/<B 的 tankId>/creatures 發出請求
// Then  回傳 404
describe('GET /api/tanks/:id/creatures 的歸屬檢查', () => {
  it('A 打 B 的 tankId 回 404', async () => {
    const client = fakeClient()

    await expect(resolveTankCreatures(client, USER_A, 'tank-b1'))
      .resolves.toEqual({ ok: false, error: TANK_NOT_FOUND })
    expectNoTankContentRead(client)
  })

  it('A 打自己的 tankId 正常拿到資料', async () => {
    const result = await resolveTankCreatures(fakeClient(), USER_A, 'tank-a1')

    expect(result).toEqual({ ok: true, value: { creatures: [expect.objectContaining({ id: 'creature-a1' })] } })
  })

  it('自己已封存的缸同樣回 404', async () => {
    await expect(resolveTankCreatures(fakeClient(), USER_A, 'tank-a-archived'))
      .resolves.toEqual({ ok: false, error: TANK_NOT_FOUND })
  })

  it('未登入時回 401，而且一次查詢都不發出', async () => {
    const client = fakeClient()

    await expect(resolveTankCreatures(client, null, 'tank-a1'))
      .resolves.toEqual({ ok: false, error: NOT_SIGNED_IN })
    expectNoQuery(client)
  })
})

// Given 我以 A 帳號登入
// When  我對 GET /api/creatures/<B 的 creatureId> 發出請求
// Then  回傳 404
describe('GET /api/creatures/:id 的歸屬檢查', () => {
  it('A 打 B 的 creatureId 回 404', async () => {
    await expect(resolveCreatureDetail(fakeClient(), USER_A, 'creature-b1'))
      .resolves.toEqual({ ok: false, error: CREATURE_NOT_FOUND })
  })

  it('A 打自己的 creatureId 正常拿到資料', async () => {
    const result = await resolveCreatureDetail(fakeClient(), USER_A, 'creature-a1')

    expect(result).toEqual({ ok: true, value: { creature: expect.objectContaining({ id: 'creature-a1' }) } })
  })

  // 自己的生物，但缸已封存——那些缸不出現在任何清單裡，就不該從詳情頁的網址繞進去
  // （getCreatureDetail 的 `tank: { userId, archivedAt: null }` 的後半段）
  it('自己已封存的缸底下的生物同樣回 404', async () => {
    await expect(resolveCreatureDetail(fakeClient(), USER_A, 'creature-a-archived'))
      .resolves.toEqual({ ok: false, error: CREATURE_NOT_FOUND })
  })

  it('未登入時回 401，而且一次查詢都不發出', async () => {
    const client = fakeClient()

    await expect(resolveCreatureDetail(client, null, 'creature-a1'))
      .resolves.toEqual({ ok: false, error: NOT_SIGNED_IN })
    expectNoQuery(client)
  })
})

// Given 我以 A 帳號登入
// When  我對 PATCH /api/creatures/<B 的 creatureId> 發出請求
// Then  回傳 404
// And   B 的那隻生物完全沒有被修改
describe('PATCH /api/creatures/:id 的歸屬檢查', () => {
  it('A 打 B 的 creatureId 回 404', async () => {
    await expect(applyCreatureStatus(fakeClient(), USER_A, 'creature-b1', bodyThunk(ALIVE_BODY)))
      .resolves.toEqual({ ok: false, error: CREATURE_NOT_FOUND })
  })

  // 這一條是本 issue 唯一「擋不住就會改到別人資料」的路徑，不是只有讀取被拒
  it('B 的那隻生物完全沒有被寫入', async () => {
    const client = fakeClient()

    await applyCreatureStatus(client, USER_A, 'creature-b1', bodyThunk({
      status: 'DEAD',
      diedOn: '2026-07-01',
      causeOfDeath: 'JUMPED',
      deathNote: '不該被寫進去的一行',
    }))

    expect(client.creature.update).not.toHaveBeenCalled()
  })

  it('A 改自己的生物正常寫入', async () => {
    const client = fakeClient()
    const result = await applyCreatureStatus(client, USER_A, 'creature-a1', bodyThunk(ALIVE_BODY))

    expect(result.ok).toBe(true)
    expect(client.creature.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'creature-a1', tank: { userId: USER_A.id, archivedAt: null } } }),
    )
  })

  // 入缸日不由請求提供（既有決定）：由 body 帶進來就能繞過「死亡日不能早於入缸日」
  it('死亡日早於實際入缸日時回 400，不採用 body 帶來的入缸日', async () => {
    const client = fakeClient()
    const result = await applyCreatureStatus(client, USER_A, 'creature-a1', bodyThunk({
      status: 'DEAD',
      diedOn: '2026-04-01',
      causeOfDeath: 'UNKNOWN',
      addedOn: '2026-01-01',
    }))

    expect(result).toMatchObject({ ok: false, error: { statusCode: 400 } })
    expect(client.creature.update).not.toHaveBeenCalled()
  })

  it('未登入時回 401，而且一次查詢都不發出', async () => {
    const client = fakeClient()

    await expect(applyCreatureStatus(client, null, 'creature-a1', bodyThunk(ALIVE_BODY)))
      .resolves.toEqual({ ok: false, error: NOT_SIGNED_IN })
    expectNoQuery(client)
  })

  // 真正的 readBody 對畸形 JSON 會 throw 400。先讀 body 再判斷身分的話，
  // 完全沒登入的人送一段壞掉的 JSON 就會拿到 400 而不是 401。
  it('未登入時連 body 都不會讀取', async () => {
    const body = bodyThunk(ALIVE_BODY)

    await applyCreatureStatus(fakeClient(), null, 'creature-a1', body)

    expect(body).not.toHaveBeenCalled()
  })

  // 歸屬沒過也一樣：#68 之前的 PATCH 就是先檢查、確認過了才讀 body
  it('打別人的 creatureId 時連 body 都不會讀取', async () => {
    const body = bodyThunk(ALIVE_BODY)

    await applyCreatureStatus(fakeClient(), USER_A, 'creature-b1', body)

    expect(body).not.toHaveBeenCalled()
  })

  it('自己已封存的缸底下的生物回 404，而且沒有被寫入', async () => {
    const client = fakeClient()

    await expect(applyCreatureStatus(client, USER_A, 'creature-a-archived', bodyThunk(ALIVE_BODY)))
      .resolves.toEqual({ ok: false, error: CREATURE_NOT_FOUND })
    expect(client.creature.update).not.toHaveBeenCalled()
  })

  // 查完到寫入之間有一段空隙。目前沒有 API 能在那段時間內改變歸屬，但「把生物換缸」
  // 是計畫中的功能——那支 API 一出現，這段空隙就變成真的可以被利用。
  // 歸屬條件因此也寫進 update 的 where：對不上就是 P2025，回與「查不到」相同的 404。
  it('查到與寫入之間歸屬變了（生物被換到別的缸）就回 404，不是 500', async () => {
    const client = fakeClient()

    client.creature.update.mockRejectedValueOnce(recordNotFound())

    await expect(applyCreatureStatus(client, USER_A, 'creature-a1', bodyThunk(ALIVE_BODY)))
      .resolves.toEqual({ ok: false, error: CREATURE_NOT_FOUND })
  })
})

// Given 我以 A 帳號登入，生物在 A 的 tank-a1，且 A 另有未封存的 tank-a2
// When  我將生物移到 tank-a2
// Then 只更新 tankId；兩端任一個不屬於 A 時都不會寫入
describe('PATCH /api/creatures/:id/move 的歸屬檢查', () => {
  it('A 能把自己的生物移到自己另一個未封存的缸，且只寫入 tankId', async () => {
    const client = fakeClient()
    const result = await moveOwnedCreature(client, USER_A, 'creature-a1', bodyThunk({ tankId: 'tank-a2' }))

    expect(result).toEqual({ ok: true, value: { creatureId: 'creature-a1', tankId: 'tank-a2' } })
    expect(client.creature.update).toHaveBeenCalledWith({
      where: { id: 'creature-a1', tank: { userId: USER_A.id, archivedAt: null } },
      data: { tankId: 'tank-a2' },
    })
  })

  it('serializable transaction 第一次衝突時會重試，第二次成功後回傳成功結果', async () => {
    const client = fakeClient()
    client.$transaction.mockRejectedValueOnce(transactionConflict())

    await expect(moveOwnedCreature(client, USER_A, 'creature-a1', bodyThunk({ tankId: 'tank-a2' })))
      .resolves.toEqual({ ok: true, value: { creatureId: 'creature-a1', tankId: 'tank-a2' } })
    expect(client.$transaction).toHaveBeenCalledTimes(2)
    expect(client.creature.update).toHaveBeenCalledTimes(1)
  })

  it('來源與目標是同一個缸時回 400，而且不寫入', async () => {
    const client = fakeClient()
    const result = await moveOwnedCreature(client, USER_A, 'creature-a1', bodyThunk({ tankId: 'tank-a1' }))

    expect(result).toMatchObject({ ok: false, error: { statusCode: 400 } })
    expect(client.creature.update).not.toHaveBeenCalled()
  })

  it('目標缸屬於 B 時回 404，而且不寫入', async () => {
    const client = fakeClient()

    await expect(moveOwnedCreature(client, USER_A, 'creature-a1', bodyThunk({ tankId: 'tank-b1' })))
      .resolves.toEqual({ ok: false, error: TANK_NOT_FOUND })
    expect(client.creature.update).not.toHaveBeenCalled()
  })

  it('目標缸不存在與屬於 B 時得到完全相同的答案', async () => {
    const missing = await moveOwnedCreature(fakeClient(), USER_A, 'creature-a1', bodyThunk({ tankId: 'tank-does-not-exist' }))
    const others = await moveOwnedCreature(fakeClient(), USER_A, 'creature-a1', bodyThunk({ tankId: 'tank-b1' }))

    expect(missing).toEqual(others)
  })

  it('目標缸已封存時回 404，而且不寫入', async () => {
    const client = fakeClient()

    await expect(moveOwnedCreature(client, USER_A, 'creature-a1', bodyThunk({ tankId: 'tank-a-archived' })))
      .resolves.toEqual({ ok: false, error: TANK_NOT_FOUND })
    expect(client.creature.update).not.toHaveBeenCalled()
  })

  it('來源生物屬於 B 時回 404，而且不讀 body 或寫入', async () => {
    const client = fakeClient()
    const body = bodyThunk({ tankId: 'tank-a2' })

    await expect(moveOwnedCreature(client, USER_A, 'creature-b1', body))
      .resolves.toEqual({ ok: false, error: CREATURE_NOT_FOUND })
    expect(body).not.toHaveBeenCalled()
    expect(client.creature.update).not.toHaveBeenCalled()
  })

  it('未登入時回 401，而且不讀 body、不查詢也不寫入', async () => {
    const client = fakeClient()
    const body = bodyThunk({ tankId: 'tank-a2' })

    await expect(moveOwnedCreature(client, null, 'creature-a1', body))
      .resolves.toEqual({ ok: false, error: NOT_SIGNED_IN })
    expect(body).not.toHaveBeenCalled()
    expectNoQuery(client)
  })
})

// Given 我以 A 帳號登入
// When  我對 GET /api/tanks 發出請求
// Then  只回傳 A 名下未封存的缸，清單裡沒有 B 的任何缸
describe('GET /api/tanks 的歸屬檢查', () => {
  it('只回傳 A 名下未封存的缸', async () => {
    const result = await resolveTankOptions(fakeClient(), USER_A)

    expect(result).toEqual({ ok: true, value: { tanks: [
      expect.objectContaining({ id: 'tank-a1' }),
      expect.objectContaining({ id: 'tank-a2' }),
    ] } })
  })

  // Given 我沒有登入 / Then 回傳 401，不回傳任何資料
  //
  // 舊行為是 200 加一個空清單。那對前端而言與「這個帳號還沒有缸」無法區分，
  // $api 的 401 攔截器（#67）也就沒有機會把人帶回登入頁。
  it('未登入時回 401，而不是 200 加一個空清單', async () => {
    const client = fakeClient()

    await expect(resolveTankOptions(client, null))
      .resolves.toEqual({ ok: false, error: NOT_SIGNED_IN })
    expectNoQuery(client)
  })
})

// Given 我以 A 帳號登入
// When  我對 POST /api/tanks 建立一個缸
// Then  新缸的 userId 是 A，而不是資料表中最早建立的那一位
describe('POST /api/tanks 的歸屬', () => {
  it('新缸掛在 A 名下', async () => {
    const client = fakeClient()
    const result = await createOwnedTank(client, USER_A, bodyThunk({ name: '新缸' }))

    expect(result.ok).toBe(true)
    expect(client.tank.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: USER_A.id }) }),
    )
  })

  it('換 B 登入時新缸就掛在 B 名下，不受資料表順序影響', async () => {
    const client = fakeClient()

    await createOwnedTank(client, USER_B, bodyThunk({ name: '新缸' }))

    expect(client.tank.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: USER_B.id }) }),
    )
  })

  // Given 我沒有登入 / Then 回傳 401
  // And POST /api/tanks 的訊息是「未登入」，不再是「請先建立使用者資料（pnpm db:seed）」
  it('未登入時回 401，訊息是「未登入」而不是叫人去跑 seed', async () => {
    const client = fakeClient()
    const result = await createOwnedTank(client, null, bodyThunk({ name: '新缸' }))

    expect(result).toEqual({ ok: false, error: NOT_SIGNED_IN })
    expect(NOT_SIGNED_IN.data.message).toContain('未登入')
    expect(NOT_SIGNED_IN.data.message).not.toContain('seed')
    expectNoQuery(client)
  })

  // 未登入的人不該先收到一份表單檢查報告——那等於告訴他這支 API 願意跟他對話。
  // 身分先於內容，401 才是「上述任何一支 API」都成立的答案。
  it('未登入且內容也不合法時仍然回 401，不是 400', async () => {
    await expect(createOwnedTank(fakeClient(), null, bodyThunk({ name: '' })))
      .resolves.toEqual({ ok: false, error: NOT_SIGNED_IN })
  })

  // 上一條餵的是「已經解析好但語意不合法」的內容，走不到 readBody 的語法解析。
  // 真正的破口在更前面：body 壓根還沒解析成功時，h3 就已經 throw 400 了。
  it('未登入時連 body 都不會讀取', async () => {
    const body = bodyThunk({ name: '新缸' })

    await createOwnedTank(fakeClient(), null, body)

    expect(body).not.toHaveBeenCalled()
  })

  // 已登入時，表單檢查照舊（既有行為，不因為本 issue 而消失）
  it('已登入但內容不合法時回 400，並附上可以直接顯示的訊息', async () => {
    const client = fakeClient()
    const result = await createOwnedTank(client, USER_A, bodyThunk({ name: '' }))

    expect(result).toMatchObject({ ok: false, error: { statusCode: 400 } })
    expect(client.tank.create).not.toHaveBeenCalled()
  })
})

// Given 某個 id 根本不存在
// When  我發出請求
// Then  回傳的狀態碼與「存在但不屬於我」完全相同
//       （分開回答等於告訴對方這個 id 存在）
describe('不存在的 id 與別人的 id 得到同一個答案', () => {
  it('缸：不存在的 tankId 與 B 的 tankId 回傳完全相同的錯誤', async () => {
    const missing = await resolveTankHome(fakeClient(), USER_A, 'tank-does-not-exist')
    const others = await resolveTankHome(fakeClient(), USER_A, 'tank-b1')

    expect(missing).toEqual(others)
  })

  it('生物：不存在的 creatureId 與 B 的 creatureId 回傳完全相同的錯誤', async () => {
    const missing = await resolveCreatureDetail(fakeClient(), USER_A, 'creature-does-not-exist')
    const others = await resolveCreatureDetail(fakeClient(), USER_A, 'creature-b1')

    expect(missing).toEqual(others)
  })

  it('PATCH：不存在的 creatureId 與 B 的 creatureId 回傳完全相同的錯誤', async () => {
    const missing = await applyCreatureStatus(fakeClient(), USER_A, 'creature-does-not-exist', bodyThunk(ALIVE_BODY))
    const others = await applyCreatureStatus(fakeClient(), USER_A, 'creature-b1', bodyThunk(ALIVE_BODY))

    expect(missing).toEqual(others)
  })
})

// 網址少了 id 那一段是既有的 400，本 issue 不改掉它，只把它排到身分檢查之後：
// 未登入的人拿到的答案該是「你是誰」，不是「你的網址寫錯了」。
describe('網址少了 id 時仍是既有的 400，但排在身分檢查之後', () => {
  it('已登入時，缺少 tankId 回 400', async () => {
    await expect(resolveTankHome(fakeClient(), USER_A, undefined))
      .resolves.toEqual({ ok: false, error: MISSING_TANK_ID })
  })

  it('已登入時，缺少 creatureId 回 400', async () => {
    await expect(resolveCreatureDetail(fakeClient(), USER_A, undefined))
      .resolves.toEqual({ ok: false, error: MISSING_CREATURE_ID })
  })

  it('未登入時，缺少 id 仍然回 401', async () => {
    await expect(resolveTankHome(fakeClient(), null, undefined))
      .resolves.toEqual({ ok: false, error: NOT_SIGNED_IN })
    await expect(resolveCreatureDetail(fakeClient(), null, undefined))
      .resolves.toEqual({ ok: false, error: NOT_SIGNED_IN })
  })
})

// 錯誤內容本身也是這道邊界的一部分：狀態碼對了，但訊息說出「這個缸屬於別人」
// 就等於把答案從 body 送了出去。
describe('錯誤內容不洩漏任何線索', () => {
  it('401 與 404 的訊息裡沒有 id、使用者或「屬於別人」這類線索', () => {
    for (const spec of [NOT_SIGNED_IN, TANK_NOT_FOUND, CREATURE_NOT_FOUND]) {
      expect(spec.data.message).not.toMatch(/user-|tank-|creature-|別人|他人/)
    }
  })

  it('401 是 401、404 是 404', () => {
    expect(NOT_SIGNED_IN.statusCode).toBe(401)
    expect(TANK_NOT_FOUND.statusCode).toBe(404)
    expect(CREATURE_NOT_FOUND.statusCode).toBe(404)
  })

  // statusMessage 過不了 h3 的 ASCII 過濾，中文一律放 data.message（shared/utils/apiError.ts）
  it('statusMessage 只有 ASCII', () => {
    for (const spec of [NOT_SIGNED_IN, TANK_NOT_FOUND, CREATURE_NOT_FOUND]) {
      expect(spec.statusMessage).toMatch(/^[\x20-\x7E]+$/)
    }
  })
})
