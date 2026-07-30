import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { LEGACY_SEED_USER_ID, TEMPLATE_USER, upsertTemplateUser } from '../../../prisma/seedUser'

// issue #65：seed 產出的是一份「沒有主人的模板」。
//
// 訪客登入的行為是「建一位新 User + 複製模板資料」，不是「登入模板那一位」，
// 所以模板不該佔用 email 唯一值、名稱也不該是某個人，而且不可被登入（沒有 Account）。
//
// 這個 job 連不到資料庫，Prisma Client 一律以假物件替身餵入
// （與 tests/unit/server/tank-write.test.ts 同一個作法）。

function fakeClient() {
  /** 依實際呼叫順序記下來——搬缸與刪使用者的先後是這支函式的重點 */
  const calls: string[] = []

  const client = {
    user: {
      upsert: vi.fn(async () => {
        calls.push('user.upsert')
        return {
          id: TEMPLATE_USER.id,
          email: TEMPLATE_USER.email,
          displayName: TEMPLATE_USER.displayName,
        }
      }),
      create: vi.fn(async () => {
        calls.push('user.create')
        return { id: 'unexpected' }
      }),
      deleteMany: vi.fn(async () => {
        calls.push('user.deleteMany')
        return { count: 1 }
      }),
    },
    tank: {
      updateMany: vi.fn(async () => {
        calls.push('tank.updateMany')
        return { count: 3 }
      }),
    },
    account: {
      create: vi.fn(async () => {
        calls.push('account.create')
        return { id: 'unexpected' }
      }),
      upsert: vi.fn(async () => {
        calls.push('account.upsert')
        return { id: 'unexpected' }
      }),
      createMany: vi.fn(async () => {
        calls.push('account.createMany')
        return { count: 1 }
      }),
    },
  }

  return { client: client as unknown as PrismaClient & typeof client, calls }
}

const seedSource = () => readFileSync(resolve(process.cwd(), 'prisma/seed.ts'), 'utf8')

// Given 一個全新的資料庫 / When 我執行 pnpm db:seed
describe('模板使用者的身分', () => {
  // Then 示範使用者的 email 為 null
  it('email 為 null，不佔用 User.email 的唯一值', async () => {
    const { client } = fakeClient()

    expect(TEMPLATE_USER.email).toBeNull()

    await upsertTemplateUser(client)

    const [args] = client.user.upsert.mock.calls[0] as unknown as [
      { create: { email: string | null }, update: { email: string | null } },
    ]

    expect(args.create.email).toBeNull()
    expect(args.update.email).toBeNull()
  })

  // Then 它的 id 與 displayName 看得出這是一份模板，而不是某個人
  it('id 與 displayName 都是模板語義，不帶任何人的名字', () => {
    expect(TEMPLATE_USER.id).toContain('template')
    expect(TEMPLATE_USER.displayName).toMatch(/示範|模板/)

    for (const value of [TEMPLATE_USER.id, TEMPLATE_USER.displayName]) {
      expect(value).not.toMatch(/kathryn/i)
    }

    // 「訪客」是每位訪客各自的帳號，模板不是訪客本人（Epic #47 第 6 節）
    expect(TEMPLATE_USER.displayName).not.toContain('訪客')
    expect(TEMPLATE_USER.id).not.toContain('guest')
  })

  it('seed.ts 走 upsertTemplateUser，不再自己寫一份使用者常數', () => {
    const source = seedSource()

    expect(source).toContain('upsertTemplateUser')
    expect(source).not.toMatch(/kathryn/i)
    expect(source).not.toContain('demo@reeflog.local')
  })

  it('回傳模板使用者，讓 seed 的其餘資料掛在它名下', async () => {
    const { client } = fakeClient()

    await expect(upsertTemplateUser(client)).resolves.toMatchObject({ id: TEMPLATE_USER.id })
  })
})

// Given seed 已執行完成 / When 我查詢模板使用者的 Account
describe('模板不可被登入', () => {
  // Then 一列都沒有
  it('不建立任何 Account', async () => {
    const { client, calls } = fakeClient()

    await upsertTemplateUser(client)

    expect(client.account.create).not.toHaveBeenCalled()
    expect(client.account.createMany).not.toHaveBeenCalled()
    expect(client.account.upsert).not.toHaveBeenCalled()
    expect(calls.filter(call => call.startsWith('account.'))).toEqual([])
  })

  // 補 Account 等於把設計退回共用訪客帳號版本（Epic #47 第 8-2 節的反向陷阱），
  // 而那不會有任何執行期測試抓得到——所以在原始碼層級擋住。
  it('seed.ts 也不建立任何 Account', () => {
    const source = seedSource()

    expect(source).not.toMatch(/prisma\.account\b/)
    expect(source).not.toMatch(/\bGUEST\b/)
  })
})

// Given 資料庫裡已有舊的 seed 使用者 seed-user-kathryn 與其名下的缸
// When 我執行 pnpm db:seed
describe('既有資料庫的搬遷', () => {
  it('搬遷的來源是舊的 seed 使用者 seed-user-kathryn', () => {
    expect(LEGACY_SEED_USER_ID).toBe('seed-user-kathryn')
  })

  // Then 那些缸先改掛到模板使用者名下
  it('把舊 seed 使用者名下的缸改掛到模板使用者', async () => {
    const { client } = fakeClient()

    await upsertTemplateUser(client)

    expect(client.tank.updateMany).toHaveBeenCalledWith({
      where: { userId: LEGACY_SEED_USER_ID },
      data: { userId: TEMPLATE_USER.id },
    })
  })

  // And 舊使用者才被刪除
  it('搬完之後移除舊的 seed 使用者', async () => {
    const { client } = fakeClient()

    await upsertTemplateUser(client)

    expect(client.user.deleteMany).toHaveBeenCalledWith({ where: { id: LEGACY_SEED_USER_ID } })
  })

  // And 缸與其下的水質、生物、保養資料全部保留
  // （Tank.userId 是 onDelete: Cascade，順序顛倒會連缸一起刪掉）
  it('先搬缸、再刪舊使用者', async () => {
    const { client, calls } = fakeClient()

    await upsertTemplateUser(client)

    expect(calls.indexOf('tank.updateMany')).toBeLessThan(calls.indexOf('user.deleteMany'))
    expect(calls).toEqual(['user.upsert', 'tank.updateMany', 'user.deleteMany'])
  })

  it('搬遷的目標與 upsert 出來的模板是同一位，常數不會各寫各的', async () => {
    const { client } = fakeClient()

    const user = await upsertTemplateUser(client)
    const [args] = client.tank.updateMany.mock.calls[0] as unknown as [
      { data: { userId: string } },
    ]

    expect(args.data.userId).toBe(user.id)
  })
})

// Given seed 已執行過一次 / When 我再執行一次
describe('重跑冪等', () => {
  // Then 不會長出第二份示範資料
  it('用固定 id upsert，不走 create', async () => {
    const { client } = fakeClient()

    await upsertTemplateUser(client)
    await upsertTemplateUser(client)

    expect(client.user.create).not.toHaveBeenCalled()

    for (const [args] of client.user.upsert.mock.calls as unknown as [
      { where: { id: string }, create: { id: string } },
    ][]) {
      expect(args.where).toEqual({ id: TEMPLATE_USER.id })
      expect(args.create.id).toBe(TEMPLATE_USER.id)
    }
  })

  // Then 也不會重複搬遷：第二輪的 updateMany 條件仍然只挑舊使用者名下的缸，
  // 模板名下的缸不會被再搬一次
  it('搬遷條件永遠只鎖定舊使用者，第二輪不會動到模板名下的缸', async () => {
    const { client } = fakeClient()

    await upsertTemplateUser(client)
    await upsertTemplateUser(client)

    for (const [args] of client.tank.updateMany.mock.calls as unknown as [
      { where: { userId: string } },
    ][]) {
      expect(args.where).toEqual({ userId: LEGACY_SEED_USER_ID })
      expect(args.where.userId).not.toBe(TEMPLATE_USER.id)
    }
  })
})
