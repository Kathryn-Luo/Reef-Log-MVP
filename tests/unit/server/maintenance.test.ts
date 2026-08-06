// @vitest-environment node
// 純函式測試，不碰 Vue 元件、Nuxt composable 或 DOM；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  clearCompletion,
  completeTask,
  findOwnedMaintenanceTask,
  getMaintenancePage,
} from '../../../server/utils/maintenance'

// 保養提醒的資料層（issue #122）。
//
// Prisma Client 由呼叫端傳入，與 homeData.ts、waterLog.ts 同一個作法：函式因此能在
// 完全連不到資料庫的情況下測試（這個 job 沒有 DATABASE_URL）。歸屬檢查不在這一層——
// 收到 tankId 時「這個缸是不是你的」已經由 server/utils/authorization.ts 判斷過了；
// 任務那三支則反過來由這裡提供 findOwnedMaintenanceTask 給授權層用（與 getCreatureDetail 同型）。
//
// 替身不是「一律回同一個值」：那樣測到的只有 mock 自己。這裡照著各函式實際下的
// where / orderBy / take 在記憶體裡做，停用的任務排不掉、upsert 蓋掉 completedAt
// 這類錯誤才有東西可紅。

interface CompletionRow {
  taskId: string
  completedAt: Date
  completedOn: Date
}

interface TaskRow {
  id: string
  tankId: string
  name: string
  intervalDays: number
  startOn: Date | null
  isActive: boolean
  displayOrder: number
  createdAt: Date
}

const date = (text: string) => new Date(`${text}T00:00:00.000Z`)

/** A 的缸有四個任務（含一個停用的），B 的缸有一個 */
const TASKS: TaskRow[] = [
  { id: 'task-feed', tankId: 'tank-a1', name: '餵食', intervalDays: 1, startOn: null, isActive: true, displayOrder: 1, createdAt: new Date('2026-05-01T02:00:00.000Z') },
  { id: 'task-water', tankId: 'tank-a1', name: '換水 10%', intervalDays: 7, startOn: date('2026-04-01'), isActive: true, displayOrder: 0, createdAt: new Date('2026-05-01T01:00:00.000Z') },
  // displayOrder 與 task-feed 相同：次要排序鍵（createdAt）才有東西可測
  { id: 'task-prefilter', tankId: 'tank-a1', name: '洗前置棉', intervalDays: 7, startOn: null, isActive: true, displayOrder: 1, createdAt: new Date('2026-05-01T03:00:00.000Z') },
  { id: 'task-retired', tankId: 'tank-a1', name: '已停用的任務', intervalDays: 7, startOn: null, isActive: false, displayOrder: 2, createdAt: new Date('2026-05-01T04:00:00.000Z') },
  { id: 'task-b', tankId: 'tank-b1', name: 'B 的任務', intervalDays: 7, startOn: null, isActive: true, displayOrder: 0, createdAt: new Date('2026-05-01T05:00:00.000Z') },
]

/** 「換水 10%」做過兩次，「餵食」一次；洗前置棉從未完成過 */
const COMPLETIONS: CompletionRow[] = [
  { taskId: 'task-water', completedAt: new Date('2026-06-24T00:10:00.000Z'), completedOn: date('2026-06-24') },
  { taskId: 'task-water', completedAt: new Date('2026-07-01T00:20:00.000Z'), completedOn: date('2026-07-01') },
  { taskId: 'task-feed', completedAt: new Date('2026-07-08T00:20:00.000Z'), completedOn: date('2026-07-08') },
]

/**
 * 記憶體版的 Prisma Client。
 *
 * `completions` 真的存著列，upsert 與 deleteMany 真的改它——「重送不覆蓋 completedAt」
 * 與「只刪當天那一筆」都是行為，不是查詢參數，只比對呼叫參數的話兩者都測不到。
 */
function fakeClient(tanks: Record<string, { userId: string, archivedAt: Date | null }> = {
  'tank-a1': { userId: 'user-a', archivedAt: null },
  'tank-b1': { userId: 'user-b', archivedAt: null },
}) {
  const completions = COMPLETIONS.map(row => ({ ...row }))

  /** nested read：completions 依 completedOn 由新到舊、只取 take 筆 */
  const withCompletions = (task: TaskRow, include?: { completions?: { orderBy?: { completedOn?: 'desc' }, take?: number } }) => ({
    ...task,
    completions: include?.completions
      ? completions
          .filter(row => row.taskId === task.id)
          .sort((left, right) => right.completedOn.getTime() - left.completedOn.getTime())
          .slice(0, include.completions.take ?? undefined)
      : [],
  })

  /** where: { id?, isActive?, tankId?, tank: { userId, archivedAt } } */
  const matches = (task: TaskRow, where: Record<string, unknown>) => {
    const tank = tanks[task.tankId]
    const owner = where.tank as { userId?: string, archivedAt?: Date | null } | undefined

    return (where.id === undefined || task.id === where.id)
      && (where.tankId === undefined || task.tankId === where.tankId)
      && (where.isActive === undefined || task.isActive === where.isActive)
      && (owner === undefined || (
        tank !== undefined
        && (owner.userId === undefined || tank.userId === owner.userId)
        && (owner.archivedAt === undefined || tank.archivedAt === owner.archivedAt)
      ))
  }

  const client = {
    maintenanceTask: {
      findMany: vi.fn(({ where, orderBy, include }: {
        where: Record<string, unknown>
        orderBy?: { displayOrder?: 'asc', createdAt?: 'asc' }[]
        include?: Parameters<typeof withCompletions>[1]
      }) => Promise.resolve(
        TASKS
          .filter(task => matches(task, where))
          // 照著送進來的 orderBy 排，不是照夾具的順序：漏掉次要鍵就會紅
          .sort((left, right) => (orderBy ?? []).reduce((decided, key) => decided
            || (key.displayOrder ? left.displayOrder - right.displayOrder : 0)
            || (key.createdAt ? left.createdAt.getTime() - right.createdAt.getTime() : 0), 0))
          .map(task => withCompletions(task, include)),
      )),
      findFirst: vi.fn(({ where, include }: { where: Record<string, unknown>, include?: Parameters<typeof withCompletions>[1] }) => {
        const task = TASKS.find(candidate => matches(candidate, where))

        return Promise.resolve(task ? withCompletions(task, include) : null)
      }),
    },
    maintenanceCompletion: {
      upsert: vi.fn(({ where, create }: {
        where: { taskId_completedOn: { taskId: string, completedOn: Date } }
        update: Record<string, unknown>
        create: { taskId: string, completedOn: Date }
      }) => {
        const key = where.taskId_completedOn
        const existing = completions.find(row => row.taskId === key.taskId && row.completedOn.getTime() === key.completedOn.getTime())

        if (existing) {
          // `update: {}`——重送一次不動任何欄位，第一次的 completedAt 因此留著
          return Promise.resolve(existing)
        }

        // completedAt 不由呼叫端帶：schema 的 @default(now()) 就是「按下去的那個瞬間」
        const created = { ...create, completedAt: new Date('2026-07-08T12:34:56.000Z') }

        completions.push(created)

        return Promise.resolve(created)
      }),
      deleteMany: vi.fn(({ where }: { where: { taskId: string, completedOn: Date } }) => {
        const before = completions.length

        for (let index = completions.length - 1; index >= 0; index--) {
          const row = completions[index]!

          if (row.taskId === where.taskId && row.completedOn.getTime() === where.completedOn.getTime()) {
            completions.splice(index, 1)
          }
        }

        return Promise.resolve({ count: before - completions.length })
      }),
    },
  }

  return Object.assign(client as unknown as PrismaClient & typeof client, { completions })
}

describe('getMaintenancePage', () => {
  // Given 我是缸主，該缸有啟用中的任務
  // When  我對 GET /api/tanks/<id>/maintenance 發出請求
  // Then  回傳這些任務，依 displayOrder 排序
  // And   每個帶 intervalDays、startOn、建立日與「最後一筆完成紀錄」
  it('回傳啟用中的任務，依 displayOrder ASC, createdAt ASC', async () => {
    const { tasks } = await getMaintenancePage(fakeClient(), 'tank-a1')

    expect(tasks.map(task => task.id)).toEqual(['task-water', 'task-feed', 'task-prefilter'])
  })

  it('每個任務帶著推算需要的四個值與最後一筆完成紀錄', async () => {
    const { tasks } = await getMaintenancePage(fakeClient(), 'tank-a1')

    expect(tasks[0]).toEqual({
      id: 'task-water',
      name: '換水 10%',
      intervalDays: 7,
      startOn: '2026-04-01',
      // schema 註解定的最後一層 fallback：少了它，「沒完成過又沒 startOn」的任務
      // 前端算不出 nextDueOn
      createdOn: '2026-05-01',
      displayOrder: 0,
      // completedOn 最大的那一筆，不是最早的那一筆
      lastCompletion: { completedAt: '2026-07-01T00:20:00.000Z', completedOn: '2026-07-01' },
    })
  })

  // Given 某個任務的 isActive 為 false
  // Then  它不出現在回傳裡，但它的完成紀錄仍留在資料庫（不刪除）
  it('停用的任務不在清單裡', async () => {
    const client = fakeClient()
    const { tasks } = await getMaintenancePage(client, 'tank-a1')

    expect(tasks.map(task => task.id)).not.toContain('task-retired')
    // 排除是查詢條件做的，不是事後過濾——後者會把停用的任務一起撈回記憶體
    expect(client.maintenanceTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tankId: 'tank-a1', isActive: true } }),
    )
  })

  // Given 某個任務從來沒有被完成過 / Then lastCompletion 為 null（不是假的日期、不是 0）
  it('從未完成過的任務 lastCompletion 是 null', async () => {
    const { tasks } = await getMaintenancePage(fakeClient(), 'tank-a1')

    expect(tasks.find(task => task.id === 'task-prefilter')).toMatchObject({ startOn: null, lastCompletion: null })
  })

  // 只取最後一筆：整份履歷是保養歷史頁的事，那一頁還不存在。撈回來再取最後一筆的話，
  // 記錄了三年的缸每開一次保養頁就把三年的履歷讀進記憶體。
  it('最後一筆完成紀錄是 nested read 的 take: 1，不是整份履歷', async () => {
    const client = fakeClient()

    await getMaintenancePage(client, 'tank-a1')

    expect(client.maintenanceTask.findMany).toHaveBeenCalledWith({
      where: { tankId: 'tank-a1', isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      include: { completions: { orderBy: { completedOn: 'desc' }, take: 1 } },
    })
  })

  it('別的缸的任務不會混進來', async () => {
    const { tasks } = await getMaintenancePage(fakeClient(), 'tank-a1')

    expect(tasks.map(task => task.id)).not.toContain('task-b')
  })

  it('沒有任何任務的缸回傳空清單', async () => {
    await expect(getMaintenancePage(fakeClient(), 'tank-empty')).resolves.toEqual({ tasks: [] })
  })
})

describe('findOwnedMaintenanceTask', () => {
  it('查得到自己缸底下啟用中的任務', async () => {
    await expect(findOwnedMaintenanceTask(fakeClient(), 'task-water', 'user-a'))
      .resolves.toMatchObject({ id: 'task-water' })
  })

  // 歸屬透過缸反查（schema.prisma 的 User 註解已定案「不把 userId 反正規化到子表」），
  // 停用與已封存一併排除——三種情況在授權層會收斂成同一個 404
  it('查詢條件包含缸的歸屬、未封存與 isActive', async () => {
    const client = fakeClient()

    await findOwnedMaintenanceTask(client, 'task-water', 'user-a')

    expect(client.maintenanceTask.findFirst).toHaveBeenCalledWith({
      where: { id: 'task-water', isActive: true, tank: { userId: 'user-a', archivedAt: null } },
      include: { completions: { orderBy: { completedOn: 'desc' }, take: 1 } },
    })
  })

  it.each([
    ['別人的任務', 'task-b', 'user-a'],
    ['停用的任務', 'task-retired', 'user-a'],
    ['不存在的任務', 'task-nope', 'user-a'],
  ])('查不到時回 null（%s）', async (_label, taskId, userId) => {
    await expect(findOwnedMaintenanceTask(fakeClient(), taskId, userId)).resolves.toBeNull()
  })

  it('自己已封存的缸底下的任務同樣查不到', async () => {
    const client = fakeClient({
      'tank-a1': { userId: 'user-a', archivedAt: new Date('2026-01-01T00:00:00.000Z') },
      'tank-b1': { userId: 'user-b', archivedAt: null },
    })

    await expect(findOwnedMaintenanceTask(client, 'task-water', 'user-a')).resolves.toBeNull()
  })
})

describe('completeTask', () => {
  // Given 「換水 10%」今天尚未完成
  // When  POST /api/maintenance-tasks/<taskId>/completions { completedOn: 今天 }
  // Then  建立一筆完成紀錄，completedAt 為此刻
  // And   回傳更新後的該任務（含這筆完成紀錄）
  it('建立當天的完成紀錄，並回傳更新後的任務', async () => {
    const client = fakeClient()

    const task = await completeTask(client, 'task-water', date('2026-07-08'), 'user-a')

    expect(task).toMatchObject({
      id: 'task-water',
      lastCompletion: { completedAt: '2026-07-08T12:34:56.000Z', completedOn: '2026-07-08' },
    })
  })

  // completedAt 不由前端帶：它是「按下去的那個瞬間」，server 的 now() 就是同一個瞬間。
  // 前端只需要帶 completedOn（日曆日），因為只有那一個值需要使用者的時區。
  it('走 @@unique([taskId, completedOn]) 的 upsert，update 是空的', async () => {
    const client = fakeClient()

    await completeTask(client, 'task-water', date('2026-07-08'), 'user-a')

    expect(client.maintenanceCompletion.upsert).toHaveBeenCalledWith({
      where: { taskId_completedOn: { taskId: 'task-water', completedOn: date('2026-07-08') } },
      update: {},
      create: { taskId: 'task-water', completedOn: date('2026-07-08') },
    })
  })

  // Given 我在網路不穩時對同一個任務連送兩次同樣的請求 / When 兩次都到了 server
  // Then  該任務今天只有一筆完成紀錄，且 completedAt 是第一次的時間
  // And   兩次都回 200，不是第二次回 409——連點不是錯誤
  it('連送兩次只留一筆，completedAt 不被第二次覆蓋', async () => {
    const client = fakeClient()

    const first = await completeTask(client, 'task-water', date('2026-07-08'), 'user-a')
    const second = await completeTask(client, 'task-water', date('2026-07-08'), 'user-a')

    expect(second.lastCompletion).toEqual(first.lastCompletion)
    expect(client.completions.filter(row => row.taskId === 'task-water' && row.completedOn.getTime() === date('2026-07-08').getTime()))
      .toHaveLength(1)
  })

  it('其他日期的完成紀錄不受影響', async () => {
    const client = fakeClient()

    await completeTask(client, 'task-water', date('2026-07-08'), 'user-a')

    expect(client.completions.filter(row => row.taskId === 'task-water')).toHaveLength(3)
  })
})

describe('clearCompletion', () => {
  // Given 「餵食」今天已完成
  // When  DELETE /api/maintenance-tasks/<taskId>/completions/<今天>
  // Then  刪除今天那一筆，回傳更新後的該任務
  // And   其他日期的完成紀錄不受影響
  it('刪掉當天那一筆，回傳更新後的任務', async () => {
    const client = fakeClient()

    const task = await clearCompletion(client, 'task-feed', date('2026-07-08'), 'user-a')

    expect(task).toMatchObject({ id: 'task-feed', lastCompletion: null })
    expect(client.maintenanceCompletion.deleteMany).toHaveBeenCalledWith({
      where: { taskId: 'task-feed', completedOn: date('2026-07-08') },
    })
  })

  it('只刪當天那一筆，其他日期留著', async () => {
    const client = fakeClient()

    const task = await clearCompletion(client, 'task-water', date('2026-07-01'), 'user-a')

    // 6/24 那一筆還在，而且它成了新的「最後一筆」
    expect(task.lastCompletion).toEqual({ completedAt: '2026-06-24T00:10:00.000Z', completedOn: '2026-06-24' })
  })

  // Given 今天本來就沒有完成紀錄 / Then 回 200 與現況（沒有東西可刪不是錯誤），不回 404
  it('沒有東西可刪時不丟錯，回傳現況', async () => {
    const client = fakeClient()

    await expect(clearCompletion(client, 'task-prefilter', date('2026-07-08'), 'user-a'))
      .resolves.toMatchObject({ id: 'task-prefilter', lastCompletion: null })
  })

  it('別的任務的完成紀錄不受影響', async () => {
    const client = fakeClient()

    await clearCompletion(client, 'task-feed', date('2026-07-08'), 'user-a')

    expect(client.completions.filter(row => row.taskId === 'task-water')).toHaveLength(2)
  })
})
