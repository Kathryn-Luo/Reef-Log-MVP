// @vitest-environment node
// 純函式測試，不碰 Vue 元件、Nuxt composable 或 DOM；理由見 test-environment.test.ts（issue #38）

import type { PrismaClient } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { del, put } from '@vercel/blob'
import {
  AVATAR_TOO_LARGE_MESSAGE,
  AVATAR_UNSUPPORTED_MESSAGE,
} from '../../../shared/utils/avatarUpload'
import { GUEST_CANNOT_UPLOAD_AVATAR, NOT_SIGNED_IN, updateOwnedAvatar } from '../../../server/utils/authorization'
import { buildAvatarPathname, vercelAvatarBlobStore } from '../../../server/utils/avatarStore'

// POST /api/profile/avatar —— 自訂頭像上傳的 server 端（issue #166）。
//
// 這個 job 連不到資料庫，Prisma Client 一律以假物件替身餵入（與 authorization.test.ts
// 同一個作法）。替身不是「一律回這個值」——它照著函式實際下的 where 條件過濾記憶體中
// 的列，所以下面那條 compare-and-set 是真的被條件擋下來的，不是夾具安排好的。
//
// Blob store 同樣以替身餵入（`updateOwnedAvatar` 的第四個參數），另外把 `@vercel/blob`
// 整包 mock 掉：unit test 一個位元組都不會送到真實的 store。

vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (pathname: string) => ({ url: `https://store.example/${pathname}` })),
  del: vi.fn(async () => {}),
}))

const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0])
const OLD_AVATAR = 'https://store.example/avatars/user-a/old.png'

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
    googleAvatarUrl: 'https://google.example/photo.jpg',
    customAvatarUrl: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    accounts: [{ provider: 'GOOGLE' }],
    ...overrides,
  }
}

/**
 * 記憶體版的 Prisma 替身。
 *
 * `findUnique` 回的是**複本**：Story 要的「回應帶回解析後的有效頭像」必須來自寫入之後
 * 重新讀到的那一列，拿著寫入前那個物件的參考也能答對的話，這條測試就形同虛設。
 */
function fakeClient(rows: UserRow[], options: { updateFails?: boolean } = {}) {
  const client = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows.find(candidate => candidate.id === where.id)
        return row ? { ...row, accounts: [...row.accounts] } : null
      }),
      updateMany: vi.fn(async ({ where, data }: {
        where: { id: string, customAvatarUrl: string | null }
        data: { customAvatarUrl: string }
      }) => {
        if (options.updateFails) {
          throw new Error('資料庫寫入失敗')
        }

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

interface Deferred {
  promise: Promise<void>
  release: () => void
}

function deferred(): Deferred {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })

  return { promise, release }
}

/**
 * Blob store 替身。`gates` 讓測試決定「哪一次上傳先完成」——併發那條 Story
 * 要的正是兩個請求以不同順序抵達資料庫。
 */
function fakeStore(options: { gates?: Deferred[], deleteFails?: boolean } = {}) {
  const created: string[] = []
  const deleted: string[] = []

  const store = {
    put: vi.fn(async (pathname: string, _data: Uint8Array, _contentType: string) => {
      const gate = options.gates?.[store.put.mock.calls.length - 1]

      if (gate) {
        await gate.promise
      }

      const url = `https://store.example/${pathname}`
      created.push(url)
      return { url }
    }),
    delete: vi.fn(async (url: string) => {
      if (options.deleteFails) {
        throw new Error('Blob 刪除失敗')
      }

      deleted.push(url)
    }),
    created,
    deleted,
  }

  return store
}

function pngUpload(overrides: Partial<{ filename: string, type: string, data: Uint8Array }> = {}) {
  return [{ name: 'file', filename: 'avatar.png', type: 'image/png', data: PNG, ...overrides }]
}

describe('updateOwnedAvatar：未登入', () => {
  // Story：「回傳 401，且在讀取或寫入任何檔案內容之前就結束」
  it('回傳 401，而且連 multipart 都沒有讀', async () => {
    const rows = [userRow()]
    const client = fakeClient(rows)
    const store = fakeStore()
    const readParts = vi.fn(async () => pngUpload())

    await expect(updateOwnedAvatar(client, null, readParts, store))
      .resolves.toEqual({ ok: false, error: NOT_SIGNED_IN })

    expect(readParts).not.toHaveBeenCalled()
    expect(store.put).not.toHaveBeenCalled()
    expect(client.user.findUnique).not.toHaveBeenCalled()
    expect(client.user.updateMany).not.toHaveBeenCalled()
  })

  it('cookie 指向的使用者已被刪除時同樣回 401，且不建立 Blob', async () => {
    const client = fakeClient([userRow()])
    const store = fakeStore()

    await expect(updateOwnedAvatar(client, { id: 'ghost' }, async () => pngUpload(), store))
      .resolves.toEqual({ ok: false, error: NOT_SIGNED_IN })

    expect(store.put).not.toHaveBeenCalled()
    expect(client.user.updateMany).not.toHaveBeenCalled()
  })
})

// Epic #160（2026-08-12 定案）：訪客不得上傳頭像。
//
// 兩個理由都不是 UX：訪客沙盒被 prisma/cleanupExpiredGuests.ts 清掉時，customAvatarUrl
// 指的 Blob 會變成永遠沒人記得的孤兒；而這是 public repo、訪客登入不需要任何憑證，
// 開放上傳等於任何人都能拿 production 的 store 當免費圖床。
describe('updateOwnedAvatar：訪客', () => {
  const guest = { id: 'user-guest' }

  function guestRow() {
    return userRow({
      id: guest.id,
      displayName: '訪客',
      email: null,
      googleAvatarUrl: null,
      accounts: [{ provider: 'GUEST' }],
    })
  }

  it('回傳 403，而且連 multipart 都沒有讀、沒有建立 Blob', async () => {
    const client = fakeClient([guestRow()])
    const store = fakeStore()
    const readParts = vi.fn(async () => pngUpload())

    await expect(updateOwnedAvatar(client, guest, readParts, store))
      .resolves.toEqual({ ok: false, error: GUEST_CANNOT_UPLOAD_AVATAR })

    // 這是這道檢查最實際的好處：匿名腳本連 2 MB 都送不進 server 的記憶體
    expect(readParts).not.toHaveBeenCalled()
    expect(store.put).not.toHaveBeenCalled()
    expect(client.user.updateMany).not.toHaveBeenCalled()
  })

  it('訪客送不合格的檔案也是 403，不會被 400 蓋掉', async () => {
    const client = fakeClient([guestRow()])
    const store = fakeStore()

    const result = await updateOwnedAvatar(
      client,
      guest,
      async () => pngUpload({ filename: 'x.svg', type: 'image/svg+xml' }),
      store,
    )

    expect(result).toEqual({ ok: false, error: GUEST_CANNOT_UPLOAD_AVATAR })
    expect(store.put).not.toHaveBeenCalled()
  })

  it('同時掛著 GUEST 與 GOOGLE 的帳號可以上傳', async () => {
    const rows = [userRow({ accounts: [{ provider: 'GUEST' }, { provider: 'GOOGLE' }] })]
    const client = fakeClient(rows)
    const store = fakeStore()

    const result = await updateOwnedAvatar(client, { id: 'user-a' }, async () => pngUpload(), store)

    expect(result.ok).toBe(true)
    expect(store.put).toHaveBeenCalledTimes(1)
    expect(rows[0]!.customAvatarUrl).toMatch(/^https:\/\/store\.example\/avatars\/user-a\//)
  })
})

describe('updateOwnedAvatar：檔案不合格', () => {
  // Story：超過 2 MB → 明確的 400，不建立 Blob，也不修改 User
  it('超過 2 MB 回 400，不建立 Blob 也不改 User', async () => {
    const rows = [userRow()]
    const client = fakeClient(rows)
    const store = fakeStore()
    const oversized = new Uint8Array(2 * 1024 * 1024 + 1)
    oversized.set(PNG.slice(0, 8))

    const result = await updateOwnedAvatar(client, { id: 'user-a' }, async () => pngUpload({ data: oversized }), store)

    expect(result).toEqual({
      ok: false,
      error: {
        statusCode: 400,
        statusMessage: 'Avatar file too large',
        data: { message: AVATAR_TOO_LARGE_MESSAGE },
      },
    })
    expect(store.put).not.toHaveBeenCalled()
    expect(client.user.updateMany).not.toHaveBeenCalled()
    expect(rows[0]!.customAvatarUrl).toBeNull()
  })

  // Story：SVG、GIF 或其他不在允許清單內的格式 → 明確的 400
  it.each([
    { label: 'SVG', filename: 'x.svg', type: 'image/svg+xml', data: new Uint8Array([0x3C, 0x73, 0x76, 0x67]) },
    { label: 'GIF', filename: 'x.gif', type: 'image/gif', data: new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) },
  ])('$label 回 400，不建立 Blob 也不改 User', async ({ filename, type, data }) => {
    const rows = [userRow({ customAvatarUrl: OLD_AVATAR })]
    const client = fakeClient(rows)
    const store = fakeStore()

    const result = await updateOwnedAvatar(
      client,
      { id: 'user-a' },
      async () => pngUpload({ filename, type, data }),
      store,
    )

    expect(result).toEqual({
      ok: false,
      error: {
        statusCode: 400,
        statusMessage: 'Unsupported avatar format',
        data: { message: AVATAR_UNSUPPORTED_MESSAGE },
      },
    })
    expect(store.put).not.toHaveBeenCalled()
    expect(client.user.updateMany).not.toHaveBeenCalled()
    expect(rows[0]!.customAvatarUrl).toBe(OLD_AVATAR)
  })

  // Story：宣稱 image/png 但 magic bytes 不是 PNG → 400
  it('宣稱 image/png 但 magic bytes 不是 PNG 時回 400，不建立 Blob 也不改 User', async () => {
    const rows = [userRow({ customAvatarUrl: OLD_AVATAR })]
    const client = fakeClient(rows)
    const store = fakeStore()
    const svgSource = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')

    const result = await updateOwnedAvatar(client, { id: 'user-a' }, async () => pngUpload({ data: svgSource }), store)

    expect(result).toEqual({
      ok: false,
      error: {
        statusCode: 400,
        statusMessage: 'Unsupported avatar format',
        data: { message: AVATAR_UNSUPPORTED_MESSAGE },
      },
    })
    expect(store.put).not.toHaveBeenCalled()
    expect(rows[0]!.customAvatarUrl).toBe(OLD_AVATAR)
  })
})

describe('updateOwnedAvatar：上傳成功', () => {
  // Story：新 Blob 建立在目前部署環境對應的 store，User.customAvatarUrl 指向新 URL，
  //        回應帶回解析後的有效頭像
  it('建立新 Blob、寫進 customAvatarUrl，並回傳解析後的有效頭像', async () => {
    const rows = [userRow()]
    const client = fakeClient(rows)
    const store = fakeStore()

    const result = await updateOwnedAvatar(client, { id: 'user-a' }, async () => pngUpload(), store)

    expect(store.put).toHaveBeenCalledTimes(1)
    expect(store.put).toHaveBeenCalledWith(expect.any(String), PNG, 'image/png')
    expect(rows[0]!.customAvatarUrl).toBe(store.created[0])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.avatarUrl).toBe(store.created[0])
      expect(result.value.avatarSource).toBe('custom')
      // Google 頭像仍在，只是被自訂頭像蓋過；本 issue 不寫入它
      expect(rows[0]!.googleAvatarUrl).toBe('https://google.example/photo.jpg')
      // User.id 只用來組 pathname，不對外回傳
      expect(Object.keys(result.value)).not.toContain('id')
    }
  })

  it('pathname 由 server 產生，使用者送來的檔名一個字都沒進去', async () => {
    const client = fakeClient([userRow()])
    const store = fakeStore()

    await updateOwnedAvatar(
      client,
      { id: 'user-a' },
      async () => pngUpload({ filename: '../../etc/passwd.png' }),
      store,
    )

    expect(store.put.mock.calls[0]![0]).toMatch(/^avatars\/user-a\/[\w-]+\.png$/)
  })

  // Story：成功且原本已有一張自訂頭像 → best-effort 刪除舊的自訂 Blob
  it('原本已有自訂頭像時，寫入成功後刪掉舊的那一張', async () => {
    const rows = [userRow({ customAvatarUrl: OLD_AVATAR })]
    const client = fakeClient(rows)
    const store = fakeStore()

    const result = await updateOwnedAvatar(client, { id: 'user-a' }, async () => pngUpload(), store)

    expect(result.ok).toBe(true)
    expect(store.deleted).toEqual([OLD_AVATAR])
    expect(rows[0]!.customAvatarUrl).toBe(store.created[0])
  })

  // Story：刪除失敗不影響這次上傳的成功結果
  it('舊 Blob 刪不掉也不讓這次上傳失敗', async () => {
    const rows = [userRow({ customAvatarUrl: OLD_AVATAR })]
    const client = fakeClient(rows)
    const store = fakeStore({ deleteFails: true })

    const result = await updateOwnedAvatar(client, { id: 'user-a' }, async () => pngUpload(), store)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.avatarUrl).toBe(store.created[0])
    }
    expect(store.delete).toHaveBeenCalledWith(OLD_AVATAR)
  })

  it('原本沒有自訂頭像時不會去刪任何東西', async () => {
    const client = fakeClient([userRow()])
    const store = fakeStore()

    await updateOwnedAvatar(client, { id: 'user-a' }, async () => pngUpload(), store)

    expect(store.delete).not.toHaveBeenCalled()
  })
})

describe('updateOwnedAvatar：寫入失敗與併發', () => {
  // Story：Blob 已上傳但 User 更新失敗 → 剛建立的 Blob 被刪除，原本的頭像保持不變
  it('DB 更新失敗時刪掉剛建立的 Blob，不留下 orphan', async () => {
    const rows = [userRow({ customAvatarUrl: OLD_AVATAR })]
    const client = fakeClient(rows, { updateFails: true })
    const store = fakeStore()

    await expect(updateOwnedAvatar(client, { id: 'user-a' }, async () => pngUpload(), store))
      .rejects.toThrow('資料庫寫入失敗')

    expect(store.created).toHaveLength(1)
    expect(store.deleted).toEqual([store.created[0]])
    // 原本的頭像保持不變，而且不是被誤刪的那一張
    expect(rows[0]!.customAvatarUrl).toBe(OLD_AVATAR)
    expect(store.deleted).not.toContain(OLD_AVATAR)
  })

  // Story：兩個上傳同時進行、以不同順序完成 → 較舊的狀態不會覆蓋較新的狀態，
  //        沒寫進 DB 的那一方刪掉自己剛上傳的 Blob
  it('併發時較晚寫入的勝出，輸家刪掉自己的 Blob 且不覆蓋新值', async () => {
    const rows = [userRow()]
    const client = fakeClient(rows)
    const gates = [deferred(), deferred()]
    const store = fakeStore({ gates })

    const first = updateOwnedAvatar(client, { id: 'user-a' }, async () => pngUpload(), store)
    const second = updateOwnedAvatar(client, { id: 'user-a' }, async () => pngUpload(), store)

    // 兩者都已經讀到「目前沒有自訂頭像」，接著刻意讓第二個請求先完成上傳與寫入
    await vi.waitFor(() => expect(store.put).toHaveBeenCalledTimes(2))
    gates[1]!.release()
    await second
    gates[0]!.release()
    const loser = await first

    const winnerUrl = store.created[0]
    expect(rows[0]!.customAvatarUrl).toBe(winnerUrl)

    // 輸家刪掉自己剛上傳的那一張，而且沒有動到勝出的那一張
    expect(store.deleted).toEqual([store.created[1]])
    expect(store.deleted).not.toContain(winnerUrl)

    // 輸家回報的是目前實際生效的頭像，不是它自己那一張
    expect(loser.ok).toBe(true)
    if (loser.ok) {
      expect(loser.value.avatarUrl).toBe(winnerUrl)
    }
  })
})

describe('buildAvatarPathname', () => {
  it('形狀是 avatars/{userId}/{random}.{ext}', () => {
    expect(buildAvatarPathname('user-a', 'png')).toMatch(/^avatars\/user-a\/[\w-]+\.png$/)
    expect(buildAvatarPathname('user-b', 'webp')).toMatch(/^avatars\/user-b\/[\w-]+\.webp$/)
  })

  // 每次上傳都是新的 immutable Blob——沿用同一個路徑的話 CDN 會繼續送舊圖
  it('同一位使用者連續兩次拿到不同的路徑', () => {
    expect(buildAvatarPathname('user-a', 'png')).not.toBe(buildAvatarPathname('user-a', 'png'))
  })
})

describe('vercelAvatarBlobStore', () => {
  beforeEach(() => {
    vi.mocked(put).mockClear()
    vi.mocked(del).mockClear()
  })

  it('以 public、不加隨機後綴、指定 contentType 的方式建立 Blob', async () => {
    await vercelAvatarBlobStore.put('avatars/user-a/abc.png', PNG, 'image/png')

    const [pathname, body, options] = vi.mocked(put).mock.calls[0]!

    expect(pathname).toBe('avatars/user-a/abc.png')
    // `PutBody` 收 Buffer，所以送出去的是同一段位元組的檢視，不是原本那個 Uint8Array
    expect(new Uint8Array(body as Buffer)).toEqual(PNG)
    expect(options).toEqual({ access: 'public', contentType: 'image/png', addRandomSuffix: false })
  })

  // token 是 server-only：由部署環境的 BLOB_READ_WRITE_TOKEN 提供，程式碼裡不出現，
  // 也因此 production 與 preview 各自打到自己的 store（見 issue #166 的實作提示）
  it('不在程式碼裡帶 token', async () => {
    await vercelAvatarBlobStore.put('avatars/user-a/abc.png', PNG, 'image/png')

    expect(vi.mocked(put).mock.calls[0]![2]).not.toHaveProperty('token')
  })

  it('刪除交給 del', async () => {
    await vercelAvatarBlobStore.delete('https://store.example/avatars/user-a/old.png')

    expect(del).toHaveBeenCalledWith('https://store.example/avatars/user-a/old.png')
  })
})
