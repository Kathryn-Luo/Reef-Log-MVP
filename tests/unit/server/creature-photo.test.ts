// @vitest-environment node
// 純函式測試，不碰 Vue 元件、Nuxt composable 或 DOM；理由見 test-environment.test.ts（issue #38）

import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import {
  CREATURE_PHOTO_TOO_LARGE_MESSAGE,
  CREATURE_PHOTO_UNSUPPORTED_MESSAGE,
} from '../../../shared/utils/creaturePhotoUpload'
import {
  CREATURE_NOT_FOUND,
  GUEST_CANNOT_UPLOAD_PHOTO,
  NOT_SIGNED_IN,
  removeOwnedCreaturePhoto,
  updateOwnedCreaturePhoto,
} from '../../../server/utils/authorization'
import { buildCreaturePhotoPathname } from '../../../server/utils/creaturePhotoStore'

// POST / DELETE /api/creatures/:id/photo —— 生物照片的 server 端（issue #154）。
//
// 與頭像（avatar-upload.test.ts / avatar-remove.test.ts）同一套替身：這個 job 連不到
// 資料庫，Prisma Client 是照著函式實際下的 where 條件過濾記憶體中那幾列的假物件，
// Blob store 由參數餵進去——一個位元組都不會送到真實的 store。
//
// 替身之所以要真的過濾條件，是因為本 issue 最要緊的兩件事恰好都寫在 where 裡：
// 「這一隻是不是你的」（tank.userId）與 compare-and-set 的 photoUrl。

const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0])
const OLD_PHOTO = 'https://store.example/creatures/creature-a/old.png'

interface CreatureRow {
  id: string
  ownerId: string
  archived: boolean
  photoUrl: string | null
}

function creatureRow(overrides: Partial<CreatureRow> = {}): CreatureRow {
  return { id: 'creature-a', ownerId: 'user-a', archived: false, photoUrl: null, ...overrides }
}

interface UserRow {
  id: string
  accounts: { provider: string }[]
}

const GOOGLE_USER: UserRow = { id: 'user-a', accounts: [{ provider: 'GOOGLE' }] }
const GUEST_USER: UserRow = { id: 'user-guest', accounts: [{ provider: 'GUEST' }] }

interface CreatureWhere {
  id: string
  photoUrl?: string | null
  tank: { userId: string, archivedAt: null }
}

/**
 * 記憶體版的 Prisma 替身。
 *
 * `findFirst` 回的是**複本**：Story 要的「回應帶回更新後的那一隻」必須來自寫入之後
 * 重新讀到的那一列，拿著寫入前那個物件的參考也能答對的話，這條測試就形同虛設。
 */
function fakeClient(
  creatures: CreatureRow[],
  users: UserRow[] = [GOOGLE_USER],
  options: { updateFails?: boolean } = {},
) {
  const matches = (row: CreatureRow, where: CreatureWhere) =>
    row.id === where.id
    && row.ownerId === where.tank.userId
    && !row.archived
    && (where.photoUrl === undefined || row.photoUrl === where.photoUrl)

  const client = {
    creature: {
      findFirst: vi.fn(async ({ where }: { where: CreatureWhere }) => {
        const row = creatures.find(candidate => matches(candidate, where))

        return row
          ? {
              id: row.id,
              tankId: 'tank-1',
              tank: { name: '主缸' },
              name: '火焰仙',
              scientificName: null,
              category: 'FISH',
              subCategory: null,
              status: 'ALIVE',
              photoUrl: row.photoUrl,
              addedOn: new Date('2026-08-01T00:00:00.000Z'),
              ailment: null,
              observedSickOn: null,
              diedOn: null,
              causeOfDeath: null,
              deathNote: null,
              price: null,
            }
          : null
      }),
      updateMany: vi.fn(async ({ where, data }: { where: CreatureWhere, data: { photoUrl: string | null } }) => {
        if (options.updateFails) {
          throw new Error('資料庫寫入失敗')
        }

        const row = creatures.find(candidate => matches(candidate, where))

        if (!row) {
          return { count: 0 }
        }

        row.photoUrl = data.photoUrl
        return { count: 1 }
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = users.find(candidate => candidate.id === where.id)
        return row ? { ...row, accounts: [...row.accounts] } : null
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

/** Blob store 替身。`gates` 讓測試決定哪一次上傳先完成——併發那一條要的正是這個。 */
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
  return [{ name: 'file', filename: 'photo.png', type: 'image/png', data: PNG, ...overrides }]
}

const OWNER = { id: 'user-a' }

describe('updateOwnedCreaturePhoto：未登入與不是你的', () => {
  it('未登入回 401，而且連 multipart 都沒有讀', async () => {
    const client = fakeClient([creatureRow()])
    const store = fakeStore()
    const readParts = vi.fn(async () => pngUpload())

    await expect(updateOwnedCreaturePhoto(client, null, 'creature-a', readParts, store))
      .resolves.toEqual({ ok: false, error: NOT_SIGNED_IN })

    expect(readParts).not.toHaveBeenCalled()
    expect(store.put).not.toHaveBeenCalled()
  })

  // 別人的生物與不存在的 id 回同一句話——分開回答等於告訴對方「這個 id 是存在的」
  it.each([
    { label: '別人的生物', id: 'creature-b' },
    { label: '不存在的 id', id: 'creature-zzz' },
    { label: '已封存的缸裡的生物', id: 'creature-archived' },
  ])('$label 回 404，不建立 Blob，也不讀 multipart', async ({ id }) => {
    const rows = [
      creatureRow(),
      creatureRow({ id: 'creature-b', ownerId: 'user-b' }),
      creatureRow({ id: 'creature-archived', archived: true }),
    ]
    const client = fakeClient(rows)
    const store = fakeStore()
    const readParts = vi.fn(async () => pngUpload())

    await expect(updateOwnedCreaturePhoto(client, OWNER, id, readParts, store))
      .resolves.toEqual({ ok: false, error: CREATURE_NOT_FOUND })

    expect(readParts).not.toHaveBeenCalled()
    expect(store.put).not.toHaveBeenCalled()
    expect(client.creature.updateMany).not.toHaveBeenCalled()
  })
})

// Story：Given 我是訪客 / When 我開啟表單 / Then 照片欄位出現但說明訪客無法上傳
//
// 畫面藏不藏是 UX，這裡是邊界：理由與頭像（#166）完全相同——訪客沙盒被
// prisma/cleanupExpiredGuests.ts 清掉時 Blob 會變成沒人記得的孤兒，而這是 public repo，
// 訪客登入不需要任何憑證，開放上傳等於任何人都能拿 production 的 store 當免費圖床。
describe('updateOwnedCreaturePhoto：訪客', () => {
  const guest = { id: 'user-guest' }

  it('回傳 403，而且連 multipart 都沒有讀、沒有建立 Blob', async () => {
    const client = fakeClient([creatureRow({ ownerId: guest.id })], [GUEST_USER])
    const store = fakeStore()
    const readParts = vi.fn(async () => pngUpload())

    await expect(updateOwnedCreaturePhoto(client, guest, 'creature-a', readParts, store))
      .resolves.toEqual({ ok: false, error: GUEST_CANNOT_UPLOAD_PHOTO })

    expect(readParts).not.toHaveBeenCalled()
    expect(store.put).not.toHaveBeenCalled()
    expect(client.creature.updateMany).not.toHaveBeenCalled()
  })

  it('訪客送不合格的檔案也是 403，不會被 400 蓋掉', async () => {
    const client = fakeClient([creatureRow({ ownerId: guest.id })], [GUEST_USER])
    const store = fakeStore()

    const result = await updateOwnedCreaturePhoto(
      client,
      guest,
      'creature-a',
      async () => pngUpload({ filename: 'x.svg', type: 'image/svg+xml' }),
      store,
    )

    expect(result).toEqual({ ok: false, error: GUEST_CANNOT_UPLOAD_PHOTO })
  })

  it('同時掛著 GUEST 與 GOOGLE 的帳號可以上傳', async () => {
    const rows = [creatureRow()]
    const client = fakeClient(rows, [{ id: 'user-a', accounts: [{ provider: 'GUEST' }, { provider: 'GOOGLE' }] }])
    const store = fakeStore()

    const result = await updateOwnedCreaturePhoto(client, OWNER, 'creature-a', async () => pngUpload(), store)

    expect(result.ok).toBe(true)
    expect(rows[0]!.photoUrl).toBe(store.created[0])
  })
})

// Story：Given 我選的檔案不是允許的圖片型別，或超過大小上限 / Then 顯示錯誤訊息，儲存被阻擋
describe('updateOwnedCreaturePhoto：檔案不合格', () => {
  it('超過 2 MB 回 400，不建立 Blob 也不改 photoUrl', async () => {
    const rows = [creatureRow({ photoUrl: OLD_PHOTO })]
    const client = fakeClient(rows)
    const store = fakeStore()
    const oversized = new Uint8Array(2 * 1024 * 1024 + 1)
    oversized.set(PNG.slice(0, 8))

    const result = await updateOwnedCreaturePhoto(
      client,
      OWNER,
      'creature-a',
      async () => pngUpload({ data: oversized }),
      store,
    )

    expect(result).toEqual({
      ok: false,
      error: {
        statusCode: 400,
        statusMessage: 'Creature photo too large',
        data: { message: CREATURE_PHOTO_TOO_LARGE_MESSAGE },
      },
    })
    expect(store.put).not.toHaveBeenCalled()
    expect(rows[0]!.photoUrl).toBe(OLD_PHOTO)
  })

  it.each([
    { label: 'SVG', filename: 'x.svg', type: 'image/svg+xml', data: new Uint8Array([0x3C, 0x73, 0x76, 0x67]) },
    { label: 'GIF', filename: 'x.gif', type: 'image/gif', data: new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) },
    { label: '宣稱 PNG 但內容不是', filename: 'x.png', type: 'image/png', data: new TextEncoder().encode('<svg></svg>') },
  ])('$label 回 400，不建立 Blob 也不改 photoUrl', async ({ filename, type, data }) => {
    const rows = [creatureRow({ photoUrl: OLD_PHOTO })]
    const client = fakeClient(rows)
    const store = fakeStore()

    const result = await updateOwnedCreaturePhoto(
      client,
      OWNER,
      'creature-a',
      async () => pngUpload({ filename, type, data }),
      store,
    )

    expect(result).toEqual({
      ok: false,
      error: {
        statusCode: 400,
        statusMessage: 'Unsupported creature photo format',
        data: { message: CREATURE_PHOTO_UNSUPPORTED_MESSAGE },
      },
    })
    expect(store.put).not.toHaveBeenCalled()
    expect(rows[0]!.photoUrl).toBe(OLD_PHOTO)
  })
})

// Story：Given 我在新增或編輯生物的表單 / When 我選了一張照片並儲存
//        Then 該生物的 photoUrl 指向已上傳的檔案，列表與詳情頁顯示這張照片
describe('updateOwnedCreaturePhoto：上傳成功', () => {
  it('建立新 Blob、寫進 photoUrl，並回傳更新後的那一隻', async () => {
    const rows = [creatureRow()]
    const client = fakeClient(rows)
    const store = fakeStore()

    const result = await updateOwnedCreaturePhoto(client, OWNER, 'creature-a', async () => pngUpload(), store)

    expect(store.put).toHaveBeenCalledTimes(1)
    expect(store.put).toHaveBeenCalledWith(expect.any(String), PNG, 'image/png')
    expect(rows[0]!.photoUrl).toBe(store.created[0])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.creature.photoUrl).toBe(store.created[0])
      expect(result.value.creature.id).toBe('creature-a')
    }
  })

  it('pathname 由 server 產生，使用者送來的檔名一個字都沒進去', async () => {
    const client = fakeClient([creatureRow()])
    const store = fakeStore()

    await updateOwnedCreaturePhoto(
      client,
      OWNER,
      'creature-a',
      async () => pngUpload({ filename: '../../etc/passwd.png' }),
      store,
    )

    expect(store.put.mock.calls[0]![0]).toMatch(/^creatures\/creature-a\/[\w-]+\.png$/)
  })

  // Story：Given 我編輯一隻已有照片的生物並換掉照片 / When 儲存成功
  //        Then photoUrl 指向新檔案（舊檔案立即刪除——與頭像同一個決定）
  it('換照片時 photoUrl 指向新檔案，舊的 Blob 立即刪除', async () => {
    const rows = [creatureRow({ photoUrl: OLD_PHOTO })]
    const client = fakeClient(rows)
    const store = fakeStore()

    const result = await updateOwnedCreaturePhoto(client, OWNER, 'creature-a', async () => pngUpload(), store)

    expect(result.ok).toBe(true)
    expect(rows[0]!.photoUrl).toBe(store.created[0])
    expect(rows[0]!.photoUrl).not.toBe(OLD_PHOTO)
    expect(store.deleted).toEqual([OLD_PHOTO])
  })

  it('舊 Blob 刪不掉也不讓這次上傳失敗', async () => {
    const rows = [creatureRow({ photoUrl: OLD_PHOTO })]
    const client = fakeClient(rows)
    const store = fakeStore({ deleteFails: true })

    const result = await updateOwnedCreaturePhoto(client, OWNER, 'creature-a', async () => pngUpload(), store)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.creature.photoUrl).toBe(store.created[0])
    }
  })

  it('原本沒有照片時不會去刪任何東西', async () => {
    const client = fakeClient([creatureRow()])
    const store = fakeStore()

    await updateOwnedCreaturePhoto(client, OWNER, 'creature-a', async () => pngUpload(), store)

    expect(store.delete).not.toHaveBeenCalled()
  })
})

describe('updateOwnedCreaturePhoto：寫入失敗與併發', () => {
  it('DB 更新失敗時刪掉剛建立的 Blob，不留下 orphan', async () => {
    const rows = [creatureRow({ photoUrl: OLD_PHOTO })]
    const client = fakeClient(rows, [GOOGLE_USER], { updateFails: true })
    const store = fakeStore()

    await expect(updateOwnedCreaturePhoto(client, OWNER, 'creature-a', async () => pngUpload(), store))
      .rejects.toThrow('資料庫寫入失敗')

    expect(store.created).toHaveLength(1)
    expect(store.deleted).toEqual([store.created[0]])
    expect(rows[0]!.photoUrl).toBe(OLD_PHOTO)
    expect(store.deleted).not.toContain(OLD_PHOTO)
  })

  it('併發時較晚寫入的勝出，輸家刪掉自己的 Blob 且不覆蓋新值', async () => {
    const rows = [creatureRow()]
    const client = fakeClient(rows)
    const gates = [deferred(), deferred()]
    const store = fakeStore({ gates })

    const first = updateOwnedCreaturePhoto(client, OWNER, 'creature-a', async () => pngUpload(), store)
    const second = updateOwnedCreaturePhoto(client, OWNER, 'creature-a', async () => pngUpload(), store)

    await vi.waitFor(() => expect(store.put).toHaveBeenCalledTimes(2))
    gates[1]!.release()
    await second
    gates[0]!.release()
    const loser = await first

    const winnerUrl = store.created[0]

    expect(rows[0]!.photoUrl).toBe(winnerUrl)
    expect(store.deleted).toEqual([store.created[1]])
    expect(store.deleted).not.toContain(winnerUrl)

    // 輸家回報的是目前實際生效的照片，不是它自己那一張已經被刪掉的
    expect(loser.ok).toBe(true)
    if (loser.ok) {
      expect(loser.value.creature.photoUrl).toBe(winnerUrl)
    }
  })
})

describe('removeOwnedCreaturePhoto', () => {
  it('未登入回 401，不刪任何 Blob', async () => {
    const client = fakeClient([creatureRow({ photoUrl: OLD_PHOTO })])
    const store = fakeStore()

    await expect(removeOwnedCreaturePhoto(client, null, 'creature-a', store))
      .resolves.toEqual({ ok: false, error: NOT_SIGNED_IN })

    expect(store.delete).not.toHaveBeenCalled()
  })

  it('別人的生物回 404，不刪任何 Blob', async () => {
    const rows = [creatureRow({ id: 'creature-b', ownerId: 'user-b', photoUrl: OLD_PHOTO })]
    const client = fakeClient(rows)
    const store = fakeStore()

    await expect(removeOwnedCreaturePhoto(client, OWNER, 'creature-b', store))
      .resolves.toEqual({ ok: false, error: CREATURE_NOT_FOUND })

    expect(store.delete).not.toHaveBeenCalled()
    expect(rows[0]!.photoUrl).toBe(OLD_PHOTO)
  })

  it('清空 photoUrl 並刪掉那個 Blob，回傳更新後的那一隻', async () => {
    const rows = [creatureRow({ photoUrl: OLD_PHOTO })]
    const client = fakeClient(rows)
    const store = fakeStore()

    const result = await removeOwnedCreaturePhoto(client, OWNER, 'creature-a', store)

    expect(rows[0]!.photoUrl).toBeNull()
    expect(store.deleted).toEqual([OLD_PHOTO])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.creature.photoUrl).toBeNull()
    }
  })

  // 連按兩次「移除」不該有第二次的錯誤（與 removeOwnedAvatar 同一個決定）
  it('本來就沒有照片時冪等地成功，不寫入也不刪除', async () => {
    const client = fakeClient([creatureRow()])
    const store = fakeStore()

    const result = await removeOwnedCreaturePhoto(client, OWNER, 'creature-a', store)

    expect(result.ok).toBe(true)
    expect(client.creature.updateMany).not.toHaveBeenCalled()
    expect(store.delete).not.toHaveBeenCalled()
  })

  it('Blob 刪不掉仍然成功（資料庫已經是最新狀態）', async () => {
    const rows = [creatureRow({ photoUrl: OLD_PHOTO })]
    const client = fakeClient(rows)
    const store = fakeStore({ deleteFails: true })

    const result = await removeOwnedCreaturePhoto(client, OWNER, 'creature-a', store)

    expect(result.ok).toBe(true)
    expect(rows[0]!.photoUrl).toBeNull()
  })

  // 訪客刻意**沒有**被擋（與 removeOwnedAvatar 同一個理由）：移除做的正是把 Blob 收掉，
  // 擋下來只會讓限制放寬前留下的照片永遠拿不掉。
  it('訪客可以移除自己生物上的照片', async () => {
    const rows = [creatureRow({ ownerId: 'user-guest', photoUrl: OLD_PHOTO })]
    const client = fakeClient(rows, [GUEST_USER])
    const store = fakeStore()

    const result = await removeOwnedCreaturePhoto(client, { id: 'user-guest' }, 'creature-a', store)

    expect(result.ok).toBe(true)
    expect(rows[0]!.photoUrl).toBeNull()
    expect(store.deleted).toEqual([OLD_PHOTO])
  })
})

describe('buildCreaturePhotoPathname', () => {
  it('形狀是 creatures/{creatureId}/{random}.{ext}', () => {
    expect(buildCreaturePhotoPathname('creature-a', 'png')).toMatch(/^creatures\/creature-a\/[\w-]+\.png$/)
    expect(buildCreaturePhotoPathname('creature-b', 'webp')).toMatch(/^creatures\/creature-b\/[\w-]+\.webp$/)
  })

  // 每次上傳都是新的 immutable Blob——沿用同一個路徑的話 CDN 會繼續送舊圖
  it('同一隻生物連續兩次拿到不同的路徑', () => {
    expect(buildCreaturePhotoPathname('creature-a', 'png')).not.toBe(buildCreaturePhotoPathname('creature-a', 'png'))
  })
})
