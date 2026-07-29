import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { GUEST_USER, LEGACY_SEED_USER_ID, upsertGuestUser } from '../../../prisma/seedUser'

// issue #47 第 5 節的定案：
//   「把 seed 的資料保留為 demo 帳號資料，登入頁多一個『以訪客身分瀏覽』的按鈕」
//   「該 seed 的名稱請改成訪客相關的字眼」
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
        return { id: GUEST_USER.id, email: GUEST_USER.email, displayName: GUEST_USER.displayName }
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
  }

  return { client: client as unknown as PrismaClient & typeof client, calls }
}

describe('seed 的示範帳號改為訪客帳號', () => {
  // Then 該 seed 的名稱是訪客相關的字眼
  it('id / email / 顯示名稱都不再帶個人姓名', () => {
    const identifiers = [GUEST_USER.id, GUEST_USER.email, GUEST_USER.displayName]

    for (const value of identifiers) {
      expect(value).not.toMatch(/kathryn/i)
    }

    expect(GUEST_USER.displayName).toContain('訪客')
    expect(GUEST_USER.id).toContain('guest')
    expect(GUEST_USER.email).toContain('guest')
  })

  it('用固定 id upsert，重跑不會長出第二位訪客', async () => {
    const { client } = fakeClient()

    await upsertGuestUser(client)

    expect(client.user.upsert).toHaveBeenCalledWith({
      where: { id: GUEST_USER.id },
      update: { email: GUEST_USER.email, displayName: GUEST_USER.displayName },
      create: { id: GUEST_USER.id, email: GUEST_USER.email, displayName: GUEST_USER.displayName },
    })
  })

  it('回傳訪客使用者，讓 seed 的其餘資料掛在它名下', async () => {
    const { client } = fakeClient()

    await expect(upsertGuestUser(client)).resolves.toMatchObject({ id: GUEST_USER.id })
  })
})

// 既有的 dev / preview 資料庫裡已經有一份舊 seed 的資料（#45 已合併）。
// 只換掉常數不會動到那些用固定 id upsert 的缸——它們會留在舊使用者名下，
// 訪客帳號則是一個沒有缸的空殼。
describe('既有資料庫的搬遷', () => {
  it('把舊 seed 使用者名下的缸改掛到訪客帳號', async () => {
    const { client } = fakeClient()

    await upsertGuestUser(client)

    expect(client.tank.updateMany).toHaveBeenCalledWith({
      where: { userId: LEGACY_SEED_USER_ID },
      data: { userId: GUEST_USER.id },
    })
  })

  // 留著它的話，getCurrentUser()（取最早建立的那一位）會挑到這個沒有缸的舊帳號
  it('搬完之後移除舊的 seed 使用者', async () => {
    const { client } = fakeClient()

    await upsertGuestUser(client)

    expect(client.user.deleteMany).toHaveBeenCalledWith({ where: { id: LEGACY_SEED_USER_ID } })
  })

  // Tank.userId 是 onDelete: Cascade——顛倒過來會把示範資料整組刪掉
  it('先搬缸、再刪舊使用者', async () => {
    const { client, calls } = fakeClient()

    await upsertGuestUser(client)

    expect(calls).toEqual(['user.upsert', 'tank.updateMany', 'user.deleteMany'])
  })

  it('搬遷的目標與 upsert 出來的訪客是同一位，常數不會各寫各的', async () => {
    const { client } = fakeClient()

    const user = await upsertGuestUser(client)
    const moved = client.tank.updateMany.mock.calls[0]![0] as { data: { userId: string } }

    expect(moved.data.userId).toBe(user.id)
  })
})

describe('prisma/seed.ts 改用訪客帳號', () => {
  const seedSource = () => readFileSync(resolve(process.cwd(), 'prisma/seed.ts'), 'utf8')

  it('seed 走 upsertGuestUser，不再自己寫一份使用者常數', () => {
    const source = seedSource()

    expect(source).toContain('upsertGuestUser')
    expect(source).not.toMatch(/kathryn/i)
    expect(source).not.toContain('demo@reeflog.local')
  })
})
