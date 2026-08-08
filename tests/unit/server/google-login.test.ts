// @vitest-environment node
// 純函式測試，不碰 Vue 元件、Nuxt composable 或 DOM；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { resolveGoogleLogin, toGoogleProfile } from '../../../server/utils/googleLogin'

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

// `defineOAuthGoogleEventHandler` 的 onSuccess 拿到的 `user` 是 Google userinfo 端點的
// 原始回應，型別上就是 `any`——TypeScript 在這個邊界上幫不了任何忙。把它交給 Prisma 之前
// 先過一次這個函式，是為了「Google 給的東西長得不對」不會變成寫進資料庫的壞資料。
describe('toGoogleProfile', () => {
  it('取出 sub、email、name 三個欄位', () => {
    expect(toGoogleProfile(PROFILE)).toEqual({
      sub: 'google-sub-1',
      email: 'diver@example.com',
      name: '潛水的人',
    })
  })

  // userinfo 還會回 picture、email_verified、locale 等等。它們沒有一個會被寫進資料庫，
  // 所以在這一層就丟掉，而不是一路帶到 resolveGoogleLogin 才靠它自己記得不要用。
  it('丟掉 picture 等用不到的欄位', () => {
    const profile = toGoogleProfile({
      ...PROFILE,
      picture: 'https://example.com/avatar.png',
      email_verified: true,
      locale: 'zh-TW',
    })

    expect(Object.keys(profile ?? {}).sort()).toEqual(['email', 'name', 'sub'])
  })

  // sub 是唯一約束的一半，缺了它就無從決定「這是誰」——寧可整個登入失敗，
  // 也不要拿空字串當 providerAccountId 建一列所有人都會撞在一起的 Account。
  it('沒有可用的 sub 時回傳 null', () => {
    expect(toGoogleProfile({ ...PROFILE, sub: undefined })).toBeNull()
    expect(toGoogleProfile({ ...PROFILE, sub: '' })).toBeNull()
    expect(toGoogleProfile({ ...PROFILE, sub: 12345 })).toBeNull()
    expect(toGoogleProfile({})).toBeNull()
  })

  it('不是物件時回傳 null', () => {
    expect(toGoogleProfile(undefined)).toBeNull()
    expect(toGoogleProfile(null)).toBeNull()
    expect(toGoogleProfile('google-sub-1')).toBeNull()
  })

  // User.email / User.displayName 都是 String?，缺了照樣登得進來（Story ① 已測過 null 的寫入）
  it('email 或 name 缺漏、型別不對時一律收斂成 null', () => {
    expect(toGoogleProfile({ sub: 'google-sub-1' })).toEqual({
      sub: 'google-sub-1',
      email: null,
      name: null,
    })
    expect(toGoogleProfile({ sub: 'google-sub-1', email: 42, name: {} })).toEqual({
      sub: 'google-sub-1',
      email: null,
      name: null,
    })
  })
})

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

  // issue #144：Google 使用者沒有訪客沙盒要複製，建立當下就把 sandboxSeededAt 填上。
  //
  // 留 null 的話首頁會判定他還欠一份示範資料，於是永遠停在「正在準備」——
  // 而那份資料永遠不會來，因為他根本不是訪客。這一條是那個畫面的唯一防線：
  // 少了它，Google 登入壞掉的樣子是「首頁一直轉」，離「少寫了一個欄位」很遠。
  it('sandboxSeededAt 在建立當下就填上，不留 null', async () => {
    const client = fakeClient()

    await resolveGoogleLogin(client, PROFILE)

    expect(client.user.create.mock.calls[0]![0].data.sandboxSeededAt).toBeInstanceOf(Date)
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

// 「先查再寫」中間有一段空隙，唯一約束會在那裡把話說完。P2002 是 Prisma 的
// 「唯一約束衝突」，用 code 而不是 instanceof 判斷：錯誤實例來自 Prisma runtime，
// 這個 job 連不到資料庫，不該為了測一個分支去把整個 runtime 拉進來。
describe('resolveGoogleLogin — 唯一約束衝突（P2002）', () => {
  /** findUnique 依序回傳指定的值，模擬「第一次查沒有、重查有了」 */
  function racingClient(accounts: unknown[], createError: unknown) {
    const findUnique = vi.fn()
    accounts.forEach(account => findUnique.mockResolvedValueOnce(account))

    const client = {
      account: { findUnique, create: vi.fn() },
      user: { create: vi.fn().mockRejectedValue(createError), findFirst: vi.fn() },
    }

    return client as unknown as PrismaClient & typeof client
  }

  // 兩個同 sub 的首次登入併發：兩邊都 miss，第二個 create 撞上
  // @@unique([provider, providerAccountId])。重查一次就知道「別人已經建好了」，
  // 這時該沿用那一位，而不是把 500 丟回給正在登入的人。
  it('另一個請求搶先建好同一個 sub 的 Account 時，重查並沿用它的 userId', async () => {
    const client = racingClient(
      [null, { id: 'account-1', userId: 'user-1' }],
      { code: 'P2002' },
    )

    await expect(resolveGoogleLogin(client, PROFILE)).resolves.toEqual({
      userId: 'user-1',
      isNewUser: false,
    })

    expect(client.account.findUnique).toHaveBeenCalledTimes(2)
  })

  // 撞的不是 sub 而是 User.email（String? @unique）——例如這個 email 已經屬於
  // 另一位用別種方式建立的使用者。重查一樣找不到 Account，代表這不是 race，
  // 而是「這兩筆資料到底是不是同一個人」的問題。
  //
  // account linking（同 email 視為同一人）是 Epic #47 第 7 節排在 MVP 之後的決定，
  // 所以這裡不自作主張把兩者接起來，也不偷偷把 email 丟掉改寫一次——原樣拋出，
  // 讓它以 500 現形，而不是變成一個沒有 email 的神祕帳號。
  it('重查仍找不到 Account 時原樣拋出，不自行做 account linking', async () => {
    const client = racingClient([null, null], { code: 'P2002' })

    await expect(resolveGoogleLogin(client, PROFILE)).rejects.toMatchObject({ code: 'P2002' })
    expect(client.account.findUnique).toHaveBeenCalledTimes(2)
  })

  // 連線中斷、逾時之類的錯誤不該被這條路徑吃掉，也不該多送一次查詢
  it('不是 P2002 的錯誤原樣拋出，且不重查', async () => {
    const client = racingClient([null], { code: 'P1001', message: 'Can\'t reach database server' })

    await expect(resolveGoogleLogin(client, PROFILE)).rejects.toMatchObject({ code: 'P1001' })
    expect(client.account.findUnique).toHaveBeenCalledTimes(1)
  })
})
