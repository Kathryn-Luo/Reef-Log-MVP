import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { resolveGoogleLogin } from '../../../server/utils/googleLogin'

// Google 登入的「查／建帳號」分支（issue #64 的 Story ① 與 ②）。
//
// 這個 job 連不到資料庫，Prisma Client 一律以假物件替身餵入。
// OAuth 回傳的 profile 也是以函式參數輸入——不打 Google，
// 因為 Google 的 redirect URI 不支援萬用字元，preview 上根本走不完那段流程。
function fakeClient(overrides: { account?: unknown } = {}) {
  const client = {
    account: {
      findUnique: vi.fn().mockResolvedValue(overrides.account ?? null),
      create: vi.fn(),
    },
    user: {
      create: vi.fn().mockResolvedValue({ id: 'user-new' }),
      findFirst: vi.fn(),
    },
  }

  return client as unknown as PrismaClient & typeof client
}

const PROFILE = {
  sub: 'google-sub-1',
  email: 'diver@example.com',
  name: '潛水的人',
}

describe('resolveGoogleLogin — 尚未註冊過的 Google 使用者', () => {
  // Story ①「Then 系統建立一位 User（email 取 Google 回傳的 email、displayName 取 name）」
  it('建立一位 User，email 取 Google 的 email、displayName 取 name', async () => {
    const client = fakeClient()

    await expect(resolveGoogleLogin(client, PROFILE)).resolves.toEqual({
      userId: 'user-new',
      isNewUser: true,
    })

    expect(client.user.create).toHaveBeenCalledTimes(1)
    expect(client.user.create.mock.calls[0]![0].data).toMatchObject({
      email: 'diver@example.com',
      displayName: '潛水的人',
    })
  })

  // Story ①「And 建立一列 Account（provider = GOOGLE、providerAccountId = OIDC 的 sub）」
  //
  // 用 nested create 一起寫入，而不是先 user.create 再 account.create：
  // 兩次寫入之間失敗會留下一位永遠登不進來的孤兒 User，下次登入又建一位新的。
  it('同一次寫入建立 Account，provider 為 GOOGLE、providerAccountId 為 OIDC 的 sub', async () => {
    const client = fakeClient()

    await resolveGoogleLogin(client, PROFILE)

    expect(client.user.create.mock.calls[0]![0].data.accounts).toEqual({
      create: { provider: 'GOOGLE', providerAccountId: 'google-sub-1' },
    })
    // 不是分兩次寫
    expect(client.account.create).not.toHaveBeenCalled()
  })

  // providerAccountId 存 sub 不是 email——email 會變更，sub 不會（schema.prisma 的註解）
  it('providerAccountId 不是 email', async () => {
    const client = fakeClient()

    await resolveGoogleLogin(client, PROFILE)

    expect(client.user.create.mock.calls[0]![0].data.accounts.create.providerAccountId)
      .not.toBe(PROFILE.email)
  })

  // User.email 是 String? @unique；Google 不保證給得出 email / name
  it('Google 沒給 email 或 name 時存成 null', async () => {
    const client = fakeClient()

    await resolveGoogleLogin(client, { sub: 'google-sub-2' })

    expect(client.user.create.mock.calls[0]![0].data).toMatchObject({
      email: null,
      displayName: null,
    })
  })
})

describe('resolveGoogleLogin — 已用同一個 Google 帳號登入過', () => {
  // Story ②「Then 系統以 (provider, providerAccountId) 查到既有 Account，沿用它的 userId」
  it('沿用既有 Account 的 userId', async () => {
    const client = fakeClient({ account: { id: 'account-1', userId: 'user-1' } })

    await expect(resolveGoogleLogin(client, PROFILE)).resolves.toEqual({
      userId: 'user-1',
      isNewUser: false,
    })
  })

  it('查詢走 (provider, providerAccountId) 這個唯一約束', async () => {
    const client = fakeClient({ account: { id: 'account-1', userId: 'user-1' } })

    await resolveGoogleLogin(client, PROFILE)

    expect(client.account.findUnique).toHaveBeenCalledWith({
      where: {
        provider_providerAccountId: {
          provider: 'GOOGLE',
          providerAccountId: 'google-sub-1',
        },
      },
    })
  })

  // Story ②「And 不建立第二位 User，也不建立第二列 Account」
  it('不建立第二位 User，也不建立第二列 Account', async () => {
    const client = fakeClient({ account: { id: 'account-1', userId: 'user-1' } })

    await resolveGoogleLogin(client, PROFILE)

    expect(client.user.create).not.toHaveBeenCalled()
    expect(client.account.create).not.toHaveBeenCalled()
  })

  // 換過 email 的人仍然是同一位：命中 Account 之後不改寫 User 的個人資料，
  // 也不會因為 email 撞到 @unique 而登不進來
  it('Google 端改過 email 也照樣沿用同一位 User', async () => {
    const client = fakeClient({ account: { id: 'account-1', userId: 'user-1' } })

    await expect(
      resolveGoogleLogin(client, { ...PROFILE, email: 'moved@example.com' }),
    ).resolves.toEqual({ userId: 'user-1', isNewUser: false })

    expect(client.user.create).not.toHaveBeenCalled()
  })
})
