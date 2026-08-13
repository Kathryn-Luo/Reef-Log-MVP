// @vitest-environment node
// 純函式測試，不碰 Vue 元件、Nuxt composable 或 DOM；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, User } from '@prisma/client'
import { GUEST_RETENTION_DAYS } from '../../../server/utils/guestCleanup'
import {
  LAST_ACTIVE_REFRESH_INTERVAL_MS,
  shouldRefreshLastActiveAt,
  touchLastActiveAt,
} from '../../../server/utils/lastActive'

// issue #175：`User.lastActiveAt` 的 schema 註解寫著「續發 session 前更新它」，
// 而實際上全 repo 沒有任何地方寫入它。這一支驗的是補上的那次寫入本身——
// 什麼時候該寫、什麼時候不該寫。

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

const NOW = new Date('2026-08-13T12:00:00.000Z')

/**
 * 有狀態的假 Prisma Client：`updateMany` 照著 Prisma 的語義評估 where 條件。
 *
 * 回傳固定 `{ count: 1 }` 的假替身在這裡不夠用——本 issue 的節流有兩層，
 * 第二層（`where` 裡的 `lastActiveAt: { lt: … }`）正是靠「搶不到就 0 筆」運作的，
 * 而永遠回 1 的替身對那一層完全不表態。
 */
function fakeClient(lastActiveAt: Date) {
  const row = { id: 'user-7', lastActiveAt }

  const client = {
    user: {
      updateMany: vi.fn(async (args: {
        where: { id?: string, lastActiveAt?: { lt: Date } }
        data: { lastActiveAt: Date }
      }) => {
        const matched = args.where.id === row.id
          && (args.where.lastActiveAt === undefined || row.lastActiveAt < args.where.lastActiveAt.lt)

        if (!matched) {
          return { count: 0 }
        }

        row.lastActiveAt = args.data.lastActiveAt

        return { count: 1 }
      }),
    },
  }

  return { client: client as unknown as Pick<PrismaClient, 'user'> & typeof client, row }
}

const userAt = (lastActiveAt: Date) => ({ id: 'user-7', lastActiveAt } as Pick<User, 'id' | 'lastActiveAt'>)

describe('shouldRefreshLastActiveAt', () => {
  it('距離上次更新還在節流區間內時不更新', () => {
    const recent = new Date(NOW.getTime() - LAST_ACTIVE_REFRESH_INTERVAL_MS + MINUTE)

    expect(shouldRefreshLastActiveAt(recent, NOW)).toBe(false)
  })

  it('距離上次更新超過節流區間時更新', () => {
    const stale = new Date(NOW.getTime() - LAST_ACTIVE_REFRESH_INTERVAL_MS - MINUTE)

    expect(shouldRefreshLastActiveAt(stale, NOW)).toBe(true)
  })

  // 邊界取「剛好等於區間 → 不寫」，與資料庫那一側的 `lt` 對齊。
  // 兩邊若一邊 `<`、一邊 `<=`，剛好落在邊界的那一次會發出一句必定 0 筆的 update。
  it('剛好等於節流區間時不更新，與資料庫那一側的 lt 對齊', () => {
    const boundary = new Date(NOW.getTime() - LAST_ACTIVE_REFRESH_INTERVAL_MS)

    expect(shouldRefreshLastActiveAt(boundary, NOW)).toBe(false)
  })

  // 時鐘往回跳（Neon 與 Vercel 各自的時間來源不必然一致）時只是「還很新」，
  // 不該變成一直寫。
  it('lastActiveAt 在未來時不更新', () => {
    expect(shouldRefreshLastActiveAt(new Date(NOW.getTime() + DAY), NOW)).toBe(false)
  })
})

describe('touchLastActiveAt', () => {
  // Given 我是訪客，帳號已建立 40 天，但昨天還在用 → 靠的就是這次寫入。
  it('距離上次更新夠久時把 lastActiveAt 推進到現在', async () => {
    const { client, row } = fakeClient(new Date(NOW.getTime() - 40 * DAY))

    await touchLastActiveAt(client, userAt(row.lastActiveAt), NOW)

    expect(client.user.updateMany).toHaveBeenCalledTimes(1)
    expect(row.lastActiveAt).toEqual(NOW)
  })

  // 節流的第二層：where 一定要帶上「還沒被更新過」的條件。
  it('update 帶上資料庫端的節流條件，併發時只會有一次真的寫進去', async () => {
    const { client } = fakeClient(new Date(NOW.getTime() - 40 * DAY))

    await touchLastActiveAt(client, userAt(new Date(NOW.getTime() - 40 * DAY)), NOW)

    expect(client.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'user-7',
        lastActiveAt: { lt: new Date(NOW.getTime() - LAST_ACTIVE_REFRESH_INTERVAL_MS) },
      },
      data: { lastActiveAt: NOW },
    })
  })

  it('距離上次更新還很近時，一句 update 都不發', async () => {
    const { client } = fakeClient(new Date(NOW.getTime() - MINUTE))

    await touchLastActiveAt(client, userAt(new Date(NOW.getTime() - MINUTE)), NOW)

    expect(client.user.updateMany).not.toHaveBeenCalled()
  })

  // Given 我在同一分鐘內連續打了多支 API / When 每一次請求都辨識出我
  // Then lastActiveAt 不會被寫入 N 次
  //
  // 每一次都拿當下資料庫裡的那一列（＝每支 API 各自 findUnique 讀到的東西），
  // 節流才是照著真實情況判斷的。
  it('同一分鐘內連打多支 API 只寫入一次', async () => {
    const { client, row } = fakeClient(new Date(NOW.getTime() - 40 * DAY))

    for (let index = 0; index < 6; index += 1) {
      await touchLastActiveAt(client, userAt(row.lastActiveAt), new Date(NOW.getTime() + index * 10 * 1000))
    }

    expect(client.user.updateMany).toHaveBeenCalledTimes(1)
    expect(row.lastActiveAt).toEqual(NOW)
  })

  // 同上，但兩支 API 讀到的是同一份「還沒被更新」的快照（真的併發時就是這樣）：
  // 這時 JS 這一層攔不住，擋下第二次寫入的是 where 裡的條件。
  it('兩支併發的請求讀到同一份舊快照時，資料庫端只讓一次寫入生效', async () => {
    const stale = new Date(NOW.getTime() - 40 * DAY)
    const { client, row } = fakeClient(stale)

    const later = new Date(NOW.getTime() + 10 * 1000)
    await touchLastActiveAt(client, userAt(stale), NOW)
    await touchLastActiveAt(client, userAt(stale), later)

    expect(client.user.updateMany).toHaveBeenCalledTimes(2)
    expect(client.user.updateMany.mock.results).toHaveLength(2)
    await expect(client.user.updateMany.mock.results[1]!.value).resolves.toEqual({ count: 0 })
    expect(row.lastActiveAt).toEqual(NOW)
  })
})

describe('LAST_ACTIVE_REFRESH_INTERVAL_MS', () => {
  // Story 的第三條 Then 講的是「同一分鐘內」，區間比一分鐘短的話那條就不成立。
  it('比一分鐘長，同一分鐘內的連續請求才會被節流掉', () => {
    expect(LAST_ACTIVE_REFRESH_INTERVAL_MS).toBeGreaterThan(MINUTE)
  })

  // 節流讓 lastActiveAt 最多落後一個區間，那段落後會直接變成「提早被清掉」的誤差。
  // 區間遠小於保留期，誤差才小到無所謂（一小時 vs 30 天）。
  it('遠小於訪客保留期，節流造成的誤差不會影響清理的正確性', () => {
    expect(LAST_ACTIVE_REFRESH_INTERVAL_MS).toBeLessThan(GUEST_RETENTION_DAYS * DAY / 100)
  })
})
