// @vitest-environment node
// 純函式測試，不碰 Vue 元件、Nuxt composable 或 DOM；理由見 test-environment.test.ts（issue #38）

import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { NOT_SIGNED_IN, removeOwnedAvatar } from '../../../server/utils/authorization'

// DELETE /api/profile/avatar —— 移除自訂頭像的 server 端（issue #167）。
//
// 與上傳（avatar-upload.test.ts）同一套替身：Prisma Client 照著函式實際下的 where 條件
// 過濾記憶體中的列，Blob store 是餵進去的第三個參數。這個 job 連不到資料庫，也不會有
// 任何一個位元組送到真實的 store。
//
// 這一支要守的重點只有一個：**要刪哪一個 Blob 完全由 server 從 DB 讀出來決定**。
// `removeOwnedAvatar` 的參數列裡沒有任何「URL」可以傳，那不是疏漏，是 Story 的第六條——
// 型別本身就是那條驗收條件的第一道防線，行為由下面「client 傳來的 URL」那一組守著。

const OLD_AVATAR = 'https://store.example/avatars/user-a/old.png'
const GOOGLE_AVATAR = 'https://google.example/photo.jpg'

interface UserRow {
  id: string
  displayName: string | null
  email: string | null
  googleAvatarUrl: string | null
  customAvatarUrl: string | null
  createdAt: Date
  accounts: { provider: string }[]
}

function userRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 'user-a',
    displayName: 'User A',
    email: 'user-a@example.com',
    googleAvatarUrl: GOOGLE_AVATAR,
    customAvatarUrl: OLD_AVATAR,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    accounts: [{ provider: 'GOOGLE' }],
    ...overrides,
  }
}

/**
 * 記憶體版的 Prisma 替身。
 *
 * `findUnique` 回的是**複本**：Story 要的「回應帶回退回後的有效頭像」必須來自清除之後
 * 重新讀到的那一列，拿著清除前那個物件的參考也能答對的話，這條測試就形同虛設。
 *
 * `onBeforeUpdate` 讓測試在「讀到舊值」與「寫入」之間插隊，用來驗併發那一條。
 */
function fakeClient(rows: UserRow[], options: { onBeforeUpdate?: () => void } = {}) {
  const client = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows.find(candidate => candidate.id === where.id)
        return row ? { ...row, accounts: [...row.accounts] } : null
      }),
      updateMany: vi.fn(async ({ where, data }: {
        where: { id: string, customAvatarUrl: string | null }
        data: { customAvatarUrl: null }
      }) => {
        options.onBeforeUpdate?.()

        const row = rows.find(candidate => candidate.id === where.id
          && candidate.customAvatarUrl === where.customAvatarUrl)

        if (!row) {
          return { count: 0 }
        }

        row.customAvatarUrl = data.customAvatarUrl
        return { count: 1 }
      }),
    },
  }

  return client as unknown as PrismaClient & typeof client
}

/** Blob store 替身，形狀與 `AvatarBlobStore` 相同 */
function fakeStore(options: { deleteFails?: boolean } = {}) {
  const deleted: string[] = []

  return {
    put: vi.fn(async (pathname: string) => ({ url: `https://store.example/${pathname}` })),
    delete: vi.fn(async (url: string) => {
      if (options.deleteFails) {
        throw new Error('Blob 刪除失敗')
      }

      deleted.push(url)
    }),
    deleted,
  }
}

describe('removeOwnedAvatar：未登入', () => {
  // Story：「回傳 401，不刪除任何 Blob，也不修改任何 User」
  it('回傳 401，不刪 Blob 也不碰資料庫', async () => {
    const rows = [userRow()]
    const client = fakeClient(rows)
    const store = fakeStore()

    await expect(removeOwnedAvatar(client, null, store))
      .resolves.toEqual({ ok: false, error: NOT_SIGNED_IN })

    expect(store.delete).not.toHaveBeenCalled()
    expect(client.user.findUnique).not.toHaveBeenCalled()
    expect(client.user.updateMany).not.toHaveBeenCalled()
    expect(rows[0]!.customAvatarUrl).toBe(OLD_AVATAR)
  })

  // cookie 有效但使用者已被刪除（訪客沙盒過期）——與其他幾支同一個答案
  it('cookie 指向的使用者已被刪除時同樣回 401，且不刪任何 Blob', async () => {
    const rows = [userRow()]
    const client = fakeClient(rows)
    const store = fakeStore()

    await expect(removeOwnedAvatar(client, { id: 'ghost' }, store))
      .resolves.toEqual({ ok: false, error: NOT_SIGNED_IN })

    expect(store.delete).not.toHaveBeenCalled()
    expect(client.user.updateMany).not.toHaveBeenCalled()
    expect(rows[0]!.customAvatarUrl).toBe(OLD_AVATAR)
  })
})

describe('removeOwnedAvatar：有自訂頭像', () => {
  // Story 第一條：同時有自訂與 Google 頭像 → 清成 null、回退回後的 Google 頭像、
  //               舊的自訂 Blob 被 best-effort 刪除
  it('清掉 customAvatarUrl、回傳 Google 頭像，並刪掉舊的自訂 Blob', async () => {
    const rows = [userRow()]
    const client = fakeClient(rows)
    const store = fakeStore()

    const result = await removeOwnedAvatar(client, { id: 'user-a' }, store)

    expect(rows[0]!.customAvatarUrl).toBeNull()
    // 唯讀欄位：本 issue 不寫入 googleAvatarUrl
    expect(rows[0]!.googleAvatarUrl).toBe(GOOGLE_AVATAR)
    expect(store.deleted).toEqual([OLD_AVATAR])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.avatarUrl).toBe(GOOGLE_AVATAR)
      expect(result.value.avatarSource).toBe('google')
      // User.id 不對外回傳（與 GET /api/profile 同一個形狀）
      expect(Object.keys(result.value)).not.toContain('id')
    }
  })

  // 順序本身就是 Story 的實作提示：先清 DB、再 best-effort 刪 Blob。
  // 反過來的話，Blob 刪掉但 DB 清除失敗，使用者會停在一個指向已不存在檔案的破圖 URL。
  it('先清資料庫、再刪 Blob', async () => {
    const rows = [userRow()]
    const order: string[] = []
    const client = fakeClient(rows, { onBeforeUpdate: () => order.push('db') })
    const store = fakeStore()

    store.delete.mockImplementation(async (url: string) => {
      order.push('blob')
      store.deleted.push(url)
    })

    await removeOwnedAvatar(client, { id: 'user-a' }, store)

    expect(order).toEqual(['db', 'blob'])
  })

  // Story 第二條：訪客只有自訂頭像、沒有 Google 頭像 → 有效頭像為 null，由前端退回首字頭像。
  //
  // 移除**不**比照上傳的 403（#166 的 GUEST_CANNOT_UPLOAD_AVATAR）：那道限制擋的是
  // 「訪客製造孤兒 Blob」，而移除做的正好是把 Blob 收掉。訪客在這裡被擋下來，
  // 反而會讓既有的自訂頭像永遠拿不掉。
  it('訪客沒有 Google 頭像時退回 null，而且不會被 403 擋下來', async () => {
    const rows = [userRow({
      id: 'user-guest',
      displayName: '訪客',
      email: null,
      googleAvatarUrl: null,
      accounts: [{ provider: 'GUEST' }],
    })]
    const client = fakeClient(rows)
    const store = fakeStore()

    const result = await removeOwnedAvatar(client, { id: 'user-guest' }, store)

    expect(rows[0]!.customAvatarUrl).toBeNull()
    expect(store.deleted).toEqual([OLD_AVATAR])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.avatarUrl).toBeNull()
      expect(result.value.avatarSource).toBe('none')
    }
  })
})

describe('removeOwnedAvatar：本來就沒有自訂頭像', () => {
  // Story 第三條：冪等——不報錯、不刪除任何 Blob，回應仍是目前的有效頭像
  it('不報錯、不刪任何 Blob，回應仍是目前的有效頭像', async () => {
    const rows = [userRow({ customAvatarUrl: null })]
    const client = fakeClient(rows)
    const store = fakeStore()

    const result = await removeOwnedAvatar(client, { id: 'user-a' }, store)

    expect(store.delete).not.toHaveBeenCalled()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.avatarUrl).toBe(GOOGLE_AVATAR)
      expect(result.value.avatarSource).toBe('google')
    }
  })

  // 連點兩次「移除」不該變成錯誤——第二次走的就是上面那條冪等路徑
  it('連續呼叫兩次都成功，第二次不再刪任何 Blob', async () => {
    const rows = [userRow()]
    const client = fakeClient(rows)
    const store = fakeStore()

    const first = await removeOwnedAvatar(client, { id: 'user-a' }, store)
    const second = await removeOwnedAvatar(client, { id: 'user-a' }, store)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (second.ok) {
      expect(second.value.avatarUrl).toBe(GOOGLE_AVATAR)
    }

    // 第一次刪掉那一張，第二次一次都沒再呼叫
    expect(store.delete).toHaveBeenCalledTimes(1)
    expect(store.deleted).toEqual([OLD_AVATAR])
  })
})

describe('removeOwnedAvatar：Blob 刪除失敗', () => {
  // Story 第四條：DB 已成功清除 → 整支請求仍視為成功，僅留下 log；
  //               不因為清不掉檔案而讓使用者卡在舊頭像
  it('刪不掉檔案仍然回成功，而且 DB 已經清乾淨', async () => {
    const rows = [userRow()]
    const client = fakeClient(rows)
    const store = fakeStore({ deleteFails: true })

    const result = await removeOwnedAvatar(client, { id: 'user-a' }, store)

    expect(store.delete).toHaveBeenCalledWith(OLD_AVATAR)
    expect(rows[0]!.customAvatarUrl).toBeNull()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.avatarUrl).toBe(GOOGLE_AVATAR)
      expect(result.value.avatarSource).toBe('google')
    }
  })
})

describe('removeOwnedAvatar：要刪哪一個由 server 決定', () => {
  // Story 第六條：「我傳入別人的 Blob URL 或任意 URL → 該輸入完全被忽略」。
  //
  // 這裡刻意讓資料庫裡有兩位使用者，各自有一張圖：呼叫時能提供的只有 session 的 id，
  // 於是被刪掉的一定是呼叫者自己 DB 上的那一張。別人的 URL 沒有任何管道能進到這支函式。
  it('刪除呼叫收到的是 DB 裡自己的那一個 URL，別人的那一張一動也沒動', async () => {
    const victimAvatar = 'https://store.example/avatars/user-b/victim.png'
    const rows = [
      userRow(),
      userRow({ id: 'user-b', customAvatarUrl: victimAvatar }),
    ]
    const client = fakeClient(rows)
    const store = fakeStore()

    await removeOwnedAvatar(client, { id: 'user-a' }, store)

    expect(store.delete).toHaveBeenCalledTimes(1)
    expect(store.delete).toHaveBeenCalledWith(OLD_AVATAR)
    expect(store.deleted).not.toContain(victimAvatar)
    expect(rows[1]!.customAvatarUrl).toBe(victimAvatar)
  })

  // 讀到舊值之後、寫入之前被別的請求換掉（例如同時有一次上傳）：
  // compare-and-set 讓資料庫自己判斷，`count === 0` 的那一方不覆蓋、也不刪。
  //
  // 這裡不刪很要緊：那個 URL 已經是別人管的了，硬刪的話換來的是「DB 指著一個
  // 已不存在的檔案」——正好是 Story 第四條要避免的破圖。
  it('讀到的值在寫入前被換掉時，不覆蓋新值也不刪任何 Blob', async () => {
    const newerAvatar = 'https://store.example/avatars/user-a/newer.png'
    const rows = [userRow()]
    const client = fakeClient(rows, {
      onBeforeUpdate: () => {
        rows[0]!.customAvatarUrl = newerAvatar
      },
    })
    const store = fakeStore()

    const result = await removeOwnedAvatar(client, { id: 'user-a' }, store)

    expect(rows[0]!.customAvatarUrl).toBe(newerAvatar)
    expect(store.delete).not.toHaveBeenCalled()

    // 回應一律來自寫入之後重新讀到的那一列，所以它報的是目前真正生效的頭像
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.avatarUrl).toBe(newerAvatar)
      expect(result.value.avatarSource).toBe('custom')
    }
  })
})
