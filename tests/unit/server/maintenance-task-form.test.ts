// @vitest-environment node

import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import {
  MAINTENANCE_TASK_NOT_FOUND,
  NOT_SIGNED_IN,
  TANK_NOT_FOUND,
  createOwnedMaintenanceTask,
  resolveMaintenanceTask,
  updateOwnedMaintenanceTask,
} from '../../../server/utils/authorization'

const USER_A = { id: 'user-a' }
const USER_B = { id: 'user-b' }

const VALID_BODY = {
  name: '換活性碳',
  intervalDays: 60,
  startOn: null,
  isActive: true,
}

const date = (value: string) => new Date(`${value}T00:00:00.000Z`)

function recordNotFound() {
  return Object.assign(new Error('Record to update not found.'), { code: 'P2025' })
}

function fakeClient() {
  const tanks = [
    { id: 'tank-a', userId: USER_A.id, archivedAt: null },
    { id: 'tank-b', userId: USER_B.id, archivedAt: null },
  ]
  const tasks = [
    {
      id: 'task-a',
      tankId: 'tank-a',
      name: '換水',
      intervalDays: 7,
      startOn: date('2026-07-01'),
      isActive: true,
      displayOrder: 3,
      note: null,
      createdAt: new Date('2026-07-01T01:00:00.000Z'),
      updatedAt: new Date('2026-07-01T01:00:00.000Z'),
    },
    {
      id: 'task-b',
      tankId: 'tank-b',
      name: '別人的任務',
      intervalDays: 30,
      startOn: null,
      isActive: true,
      displayOrder: 0,
      note: null,
      createdAt: new Date('2026-07-01T02:00:00.000Z'),
      updatedAt: new Date('2026-07-01T02:00:00.000Z'),
    },
  ]
  const completions = [
    { taskId: 'task-a', completedOn: date('2026-08-01'), completedAt: new Date('2026-08-01T01:20:00.000Z') },
  ]

  const withCompletions = (task: (typeof tasks)[number]) => ({
    ...task,
    completions: completions.filter(item => item.taskId === task.id),
  })

  const client = {
    tank: {
      findFirst: vi.fn(({ where }: { where: { id: string, userId: string, archivedAt: null } }) =>
        Promise.resolve(tanks.find(tank => tank.id === where.id && tank.userId === where.userId && tank.archivedAt === null) ?? null)),
    },
    maintenanceTask: {
      findFirst: vi.fn((args: { where: Record<string, unknown>, orderBy?: unknown, select?: unknown }) => {
        if (args.orderBy) {
          const matches = tasks.filter(task => task.tankId === args.where.tankId)
            .sort((left, right) => right.displayOrder - left.displayOrder)

          return Promise.resolve(matches[0] ? { displayOrder: matches[0].displayOrder } : null)
        }

        const owner = args.where.tank as { userId?: string, archivedAt?: null } | undefined
        const task = tasks.find((candidate) => {
          const tank = tanks.find(item => item.id === candidate.tankId)

          return candidate.id === args.where.id
            && (args.where.isActive === undefined || candidate.isActive === args.where.isActive)
            && (!owner || (tank?.userId === owner.userId && tank.archivedAt === owner.archivedAt))
        })

        return Promise.resolve(task ? withCompletions(task) : null)
      }),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const created = {
          id: 'task-new',
          tankId: data.tankId as string,
          name: data.name as string,
          intervalDays: data.intervalDays as number,
          startOn: data.startOn as Date | null,
          isActive: data.isActive as boolean,
          displayOrder: data.displayOrder as number,
          note: null,
          createdAt: new Date('2026-08-11T03:00:00.000Z'),
          updatedAt: new Date('2026-08-11T03:00:00.000Z'),
        }

        tasks.push(created)
        return Promise.resolve(withCompletions(created))
      }),
      update: vi.fn(({ where, data }: { where: { id: string, isActive: boolean, tank: { userId: string, archivedAt: null } }, data: Record<string, unknown> }) => {
        const index = tasks.findIndex((candidate) => {
          const tank = tanks.find(item => item.id === candidate.tankId)
          return candidate.id === where.id
            && candidate.isActive === where.isActive
            && tank?.userId === where.tank.userId
            && tank.archivedAt === where.tank.archivedAt
        })

        if (index < 0) {
          return Promise.reject(recordNotFound())
        }

        tasks[index] = { ...tasks[index]!, ...data, updatedAt: new Date('2026-08-11T04:00:00.000Z') }
        return Promise.resolve(withCompletions(tasks[index]!))
      }),
      findMany: vi.fn(({ where }: { where: { tankId: string, isActive: boolean } }) => Promise.resolve(
        tasks.filter(task => task.tankId === where.tankId && task.isActive === where.isActive).map(withCompletions),
      )),
    },
    maintenanceCompletion: {
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  }

  return Object.assign(client as unknown as PrismaClient & typeof client, { tasks, completions })
}

const readBody = (body: unknown) => vi.fn().mockResolvedValue(body)

describe('保養任務 detail/create/update API', () => {
  it('未登入時先回 401，不讀 body 或碰資料庫', async () => {
    const client = fakeClient()
    const body = readBody(VALID_BODY)

    await expect(createOwnedMaintenanceTask(client, null, 'tank-a', body))
      .resolves.toEqual({ ok: false, error: NOT_SIGNED_IN })
    await expect(updateOwnedMaintenanceTask(client, null, 'task-a', body))
      .resolves.toEqual({ ok: false, error: NOT_SIGNED_IN })
    expect(body).not.toHaveBeenCalled()
    expect(client.maintenanceTask.create).not.toHaveBeenCalled()
    expect(client.maintenanceTask.update).not.toHaveBeenCalled()
  })

  it('別人的缸不能建立，別人的任務不能讀取或編輯', async () => {
    const client = fakeClient()

    await expect(createOwnedMaintenanceTask(client, USER_A, 'tank-b', readBody(VALID_BODY)))
      .resolves.toEqual({ ok: false, error: TANK_NOT_FOUND })
    await expect(resolveMaintenanceTask(client, USER_A, 'task-b'))
      .resolves.toEqual({ ok: false, error: MAINTENANCE_TASK_NOT_FOUND })
    await expect(updateOwnedMaintenanceTask(client, USER_A, 'task-b', readBody(VALID_BODY)))
      .resolves.toEqual({ ok: false, error: MAINTENANCE_TASK_NOT_FOUND })
  })

  it('建立時 startOn 留白、預設啟用，並接在既有任務最後', async () => {
    const client = fakeClient()
    const result = await createOwnedMaintenanceTask(
      client,
      USER_A,
      'tank-a',
      readBody({ name: ' 換活性碳 ', intervalDays: '60', startOn: '', localCreatedOn: '2026-08-11' }),
      new Date('2026-08-11T03:00:00.000Z'),
    )

    expect(result).toMatchObject({
      ok: true,
      value: { task: { id: 'task-new', name: '換活性碳', intervalDays: 60, startOn: '2026-08-11', isActive: true, displayOrder: 4 } },
    })
    expect(client.maintenanceTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tankId: 'tank-a', startOn: date('2026-08-11'), isActive: true, displayOrder: 4 }),
    }))
  })

  it('UTC+8 凌晨建立且起算日留白時，保存瀏覽器的當地建立日', async () => {
    const client = fakeClient()
    const result = await createOwnedMaintenanceTask(
      client,
      USER_A,
      'tank-a',
      readBody({ ...VALID_BODY, startOn: '', localCreatedOn: '2026-08-12' }),
      new Date('2026-08-11T16:30:00.000Z'),
    )

    expect(result).toMatchObject({
      ok: true,
      value: { task: { startOn: '2026-08-12', createdOn: '2026-08-11' } },
    })
  })

  it('建立請求缺少或偽造超出時區範圍的當地建立日時回 400', async () => {
    const client = fakeClient()
    const now = new Date('2026-08-11T16:30:00.000Z')

    await expect(createOwnedMaintenanceTask(client, USER_A, 'tank-a', readBody(VALID_BODY), now))
      .resolves.toMatchObject({ ok: false, error: { statusCode: 400 } })
    await expect(createOwnedMaintenanceTask(
      client,
      USER_A,
      'tank-a',
      readBody({ ...VALID_BODY, localCreatedOn: '2026-08-09' }),
      now,
    )).resolves.toMatchObject({ ok: false, error: { statusCode: 400 } })
  })

  it('編輯週期不修改或刪除既有完成履歷', async () => {
    const client = fakeClient()
    const before = client.completions.map(item => ({ ...item }))

    const result = await updateOwnedMaintenanceTask(
      client,
      USER_A,
      'task-a',
      readBody({ ...VALID_BODY, intervalDays: 30 }),
    )

    expect(result).toMatchObject({ ok: true, value: { task: { id: 'task-a', intervalDays: 30 } } })
    expect(client.completions).toEqual(before)
    expect(client.maintenanceCompletion.create).not.toHaveBeenCalled()
    expect(client.maintenanceCompletion.update).not.toHaveBeenCalled()
    expect(client.maintenanceCompletion.deleteMany).not.toHaveBeenCalled()
  })

  it('停用只更新 task，完成履歷保留且 active 清單不再回傳', async () => {
    const client = fakeClient()
    const before = client.completions.map(item => ({ ...item }))

    const result = await updateOwnedMaintenanceTask(
      client,
      USER_A,
      'task-a',
      readBody({ ...VALID_BODY, isActive: false }),
    )

    expect(result).toMatchObject({ ok: true, value: { task: { id: 'task-a', isActive: false } } })
    expect(client.completions).toEqual(before)
    expect(client.tasks.find(task => task.id === 'task-a')?.isActive).toBe(false)
    expect((await client.maintenanceTask.findMany({ where: { tankId: 'tank-a', isActive: true } }))).toHaveLength(0)
  })

  it('PATCH 拒絕以 tankId 跨缸搬動任務', async () => {
    const client = fakeClient()
    const result = await updateOwnedMaintenanceTask(
      client,
      USER_A,
      'task-a',
      readBody({ ...VALID_BODY, tankId: 'tank-b' }),
    )

    expect(result).toMatchObject({ ok: false, error: { statusCode: 400 } })
    expect(client.maintenanceTask.update).not.toHaveBeenCalled()
  })

  it('POST 與 PATCH 對超大週期回 400，不讓 Prisma 寫入時才拋 500', async () => {
    const client = fakeClient()
    const oversized = { ...VALID_BODY, intervalDays: 2_147_483_648 }

    await expect(createOwnedMaintenanceTask(
      client,
      USER_A,
      'tank-a',
      readBody({ ...oversized, localCreatedOn: '2026-08-11' }),
      new Date('2026-08-11T03:00:00.000Z'),
    )).resolves.toMatchObject({ ok: false, error: { statusCode: 400 } })
    await expect(updateOwnedMaintenanceTask(client, USER_A, 'task-a', readBody(oversized)))
      .resolves.toMatchObject({ ok: false, error: { statusCode: 400 } })

    expect(client.maintenanceTask.create).not.toHaveBeenCalled()
    expect(client.maintenanceTask.update).not.toHaveBeenCalled()
  })
})
