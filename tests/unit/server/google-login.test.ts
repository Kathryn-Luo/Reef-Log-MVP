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
      update: vi.fn().mockResolvedValue({ id: 'user-1' }),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
    },
  }

  return client as unknown as PrismaClient & typeof client
}

const PROFILE = {
  sub: 'google-sub-1',
  email: 'diver@example.com',
  name: '潛水的人',
  picture: 'https://lh3.googleusercontent.com/a/avatar-1',
}

/** 第 n 次 user.update 收到的參數（issue #165） */
function updateArgs(client: ReturnType<typeof fakeClient>, index = 0) {
  const [args] = client.user.update.mock.calls[index] as unknown as [{
    where: { id: string }
    data: Record<string, unknown>
  }]

  return args
}

// `defineOAuthGoogleEventHandler` 的 onSuccess 拿到的 `user` 是 Google userinfo 端點的
// 原始回應，型別上就是 `any`——TypeScript 在這個邊界上幫不了任何忙。把它交給 Prisma 之前
// 先過一次這個函式，是為了「Google 給的東西長得不對」不會變成寫進資料庫的壞資料。
describe('toGoogleProfile', () => {
  it('取出 sub、email、name、picture 四個欄位', () => {
    expect(toGoogleProfile(PROFILE)).toEqual({
      sub: 'google-sub-1',
      email: 'diver@example.com',
      name: '潛水的人',
      picture: 'https://lh3.googleusercontent.com/a/avatar-1',
    })
  })

  // issue #165 起 picture 是要寫進 User.googleAvatarUrl 的資料，因此多留這一欄；
  // email_verified、locale 等其餘欄位仍然沒有一個會被寫進資料庫，在這一層就丟掉，
  // 而不是一路帶到 resolveGoogleLogin 才靠它自己記得不要用。
  it('留下 picture，丟掉 email_verified、locale 等用不到的欄位', () => {
    const profile = toGoogleProfile({
      ...PROFILE,
      email_verified: true,
      locale: 'zh-TW',
    })

    expect(Object.keys(profile ?? {}).sort()).toEqual(['email', 'name', 'picture', 'sub'])
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
    expect(toGoogleProfile({ sub: 'google-sub-1' })).toMatchObject({
      sub: 'google-sub-1',
      email: null,
      name: null,
    })
    expect(toGoogleProfile({ sub: 'google-sub-1', email: 42, name: {} })).toMatchObject({
      sub: 'google-sub-1',
      email: null,
      name: null,
    })
  })

  // issue #165 的 Story④「Given Google 的回應沒有 picture、或 picture 不是字串
  // Then 當成『Google 沒給』，不寫入垃圾值」——收斂在這一層，寫入端因此只要處理 null。
  // 空字串一併當成沒給：它進了 <img src=""> 只會是一張破圖。
  it('picture 缺漏、型別不對或為空字串時一律收斂成 null', () => {
    expect(toGoogleProfile({ sub: 'google-sub-1' })!.picture).toBeNull()
    expect(toGoogleProfile({ sub: 'google-sub-1', picture: 42 })!.picture).toBeNull()
    expect(toGoogleProfile({ sub: 'google-sub-1', picture: {} })!.picture).toBeNull()
    expect(toGoogleProfile({ sub: 'google-sub-1', picture: null })!.picture).toBeNull()
    expect(toGoogleProfile({ sub: 'google-sub-1', picture: '' })!.picture).toBeNull()
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

  // issue #165 Story①「Given Google 的 OAuth 回應包含 picture / When 我完成 Google 登入
  // / Then User.googleAvatarUrl 被寫入或更新為該 picture URL」——首次登入這一半。
  //
  // 建帳號這一次沒有「既有值會被蓋掉」的問題（這一列現在才存在），所以和 displayName
  // 一樣直接寫進 nested create，不需要另一次 update。
  it('建立 User 時把 picture 寫進 googleAvatarUrl', async () => {
    const client = fakeClient()

    await resolveGoogleLogin(client, PROFILE)

    expect(client.user.create.mock.calls[0]![0].data).toMatchObject({
      googleAvatarUrl: 'https://lh3.googleusercontent.com/a/avatar-1',
    })
  })

  // Story④：Google 沒給 picture 時不寫入垃圾值，登入照常成功
  it('Google 沒給 picture 時 googleAvatarUrl 存成 null，登入仍然成功', async () => {
    const client = fakeClient()

    await expect(resolveGoogleLogin(client, { sub: 'google-sub-2' })).resolves.toEqual({
      userId: 'user-new',
      isNewUser: true,
    })

    expect(client.user.create.mock.calls[0]![0].data.googleAvatarUrl).toBeNull()
  })

  // 建帳號這一次**不**寫 customAvatarUrl：自訂頭像只能由使用者自己上傳
  // （POST /api/profile/avatar），Google 這條路徑一步都不該碰它。
  it('不寫入 customAvatarUrl', async () => {
    const client = fakeClient()

    await resolveGoogleLogin(client, PROFILE)

    expect(client.user.create.mock.calls[0]![0].data).not.toHaveProperty('customAvatarUrl')
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

  // 換過 email 的人仍然是同一位：命中 Account 之後不改寫 User 的 email，
  // 也不會因為 email 撞到 @unique 而登不進來
  it('Google 端改過 email 也照樣沿用同一位 User', async () => {
    const client = fakeClient({ account: { id: 'account-1', userId: 'user-1' } })

    await expect(
      resolveGoogleLogin(client, { ...PROFILE, email: 'moved@example.com' }),
    ).resolves.toEqual({ userId: 'user-1', isNewUser: false })

    expect(client.user.create).not.toHaveBeenCalled()
    expect(updateArgs(client).data).not.toHaveProperty('email')
  })

  // issue #165 Story①（既有使用者這一半）：「Then User.googleAvatarUrl 被寫入或更新為該 picture URL」
  it('把最新的 picture 更新到那一位的 googleAvatarUrl', async () => {
    const client = fakeClient({ account: { id: 'account-1', userId: 'user-1' } })

    await resolveGoogleLogin(client, { ...PROFILE, picture: 'https://lh3.googleusercontent.com/a/avatar-2' })

    expect(client.user.update).toHaveBeenCalledTimes(1)
    expect(updateArgs(client)).toEqual({
      where: { id: 'user-1' },
      data: { googleAvatarUrl: 'https://lh3.googleusercontent.com/a/avatar-2' },
    })
  })

  // ⚠ 這是本 issue 的主要風險，也是它唯一新增 update 的理由。
  //
  // Story②「customAvatarUrl 完全不被觸碰」與 Story③「displayName 完全不被觸碰」：
  // 斷言的是 **update 收到的 data 只有 googleAvatarUrl 一個鍵**，而不是「結果值碰巧沒變」。
  // 後者在假的 Prisma Client 上恆真——真正會出事的寫法（把整個 profile 物件展開進 data）
  // 只有從 data 的形狀看得出來。
  it('update 的 data 只有 googleAvatarUrl 一個欄位', async () => {
    const client = fakeClient({ account: { id: 'account-1', userId: 'user-1' } })

    await resolveGoogleLogin(client, PROFILE)

    expect(Object.keys(updateArgs(client).data)).toEqual(['googleAvatarUrl'])
  })

  // Story②：使用者上傳過自訂頭像之後再登入，customAvatarUrl 不進 update 的 data，
  // 所以 Profile 頁的 custom → google → 名稱首字優先序仍然停在 custom。
  it('使用者上傳過自訂頭像時，update 不碰 customAvatarUrl', async () => {
    const client = fakeClient({ account: { id: 'account-1', userId: 'user-1' } })

    await resolveGoogleLogin(client, PROFILE)

    expect(updateArgs(client).data).not.toHaveProperty('customAvatarUrl')
  })

  // Story③：使用者把顯示名稱改成「小魚缸管理員」（#171）之後再登入，
  // Google 端的本名不該把它蓋回去——而且蓋掉是靜默的，只有這條測試攔得住。
  it('使用者改過顯示名稱時，update 不碰 displayName', async () => {
    const client = fakeClient({ account: { id: 'account-1', userId: 'user-1' } })

    await resolveGoogleLogin(client, { ...PROFILE, name: 'Google 上的本名' })

    expect(updateArgs(client).data).not.toHaveProperty('displayName')
  })

  // Story④：這次的回應沒有 picture，不代表使用者的頭像該被清掉——那是「Google 這次
  // 沒給」，不是「Google 說沒有」。整個 update 就不送，既有值原樣留著，登入照常完成。
  it('Google 沒給 picture 時完全不送 update，登入仍然成功', async () => {
    const client = fakeClient({ account: { id: 'account-1', userId: 'user-1' } })

    await expect(
      resolveGoogleLogin(client, { sub: 'google-sub-1', picture: null }),
    ).resolves.toEqual({ userId: 'user-1', isNewUser: false })

    expect(client.user.update).not.toHaveBeenCalled()
  })

  // Story⑤「Given 我是在本功能上線前就存在的 Google 使用者 / When 我還沒有重新登入過
  // / Then googleAvatarUrl 維持 null，不做任何無憑證的資料回填」。
  //
  // 唯一的憑證是「這次登入的 Google 回應」，所以寫入永遠指名登入中的那一位（where: { id }）。
  // 沒有批次回填的路徑——沒重新登入的人，這支函式根本不會碰到他那一列。
  it('只更新登入中的那一位，沒有任何批次回填', async () => {
    const client = fakeClient({ account: { id: 'account-1', userId: 'user-1' } })

    await resolveGoogleLogin(client, PROFILE)

    expect(client.user.updateMany).not.toHaveBeenCalled()
    expect(client.user.update.mock.calls.every(
      ([args]) => (args as { where: { id: string } }).where.id === 'user-1',
    )).toBe(true)
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
      user: {
        create: vi.fn().mockRejectedValue(createError),
        update: vi.fn().mockResolvedValue({ id: 'user-1' }),
        updateMany: vi.fn(),
        findFirst: vi.fn(),
      },
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

  // 重查沿用的那一位走的是「既有使用者」那條路，頭像的處理因此完全一樣：
  // 只更新 googleAvatarUrl，一個字都不碰 displayName / customAvatarUrl（issue #165）。
  it('重查沿用既有 userId 時，同樣只更新 googleAvatarUrl', async () => {
    const client = racingClient(
      [null, { id: 'account-1', userId: 'user-1' }],
      { code: 'P2002' },
    )

    await resolveGoogleLogin(client, PROFILE)

    expect(client.user.update.mock.calls[0]![0]).toEqual({
      where: { id: 'user-1' },
      data: { googleAvatarUrl: 'https://lh3.googleusercontent.com/a/avatar-1' },
    })
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
