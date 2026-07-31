// @vitest-environment node
// 純函式測試，不碰 Vue 元件、Nuxt composable 或 DOM；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { TEMPLATE_USER } from '../../../prisma/seedUser'
import { copyTemplateSandbox } from '../../../server/utils/guestSandbox'

// 訪客沙盒的「複製鏈」（issue #66 的 Story ① 第三條、Story ④）。
//
// 這個 job 連不到資料庫，Prisma Client 一律以假物件替身餵入（與 google-login.test.ts
// 同一個作法）。模板資料以夾具給定：這裡要驗的是「複製了什麼」，不是 seed 寫了什麼。
//
// 兩件事最容易寫錯，所以測得特別緊：
//   1. 沿用模板的固定 id —— 第二位訪客會直接撞上主鍵，或更糟：兩位訪客共用同一列。
//   2. 反過來動到模板 —— 訪客 A 一改，之後每一位訪客拿到的示範資料都跟著髒（Story ④）。

const TEMPLATE_TANK = {
  id: 'seed-tank-main',
  userId: TEMPLATE_USER.id,
  name: '主缸',
  sizeSpec: '4 尺',
  volumeLiters: 420,
  setupType: 'SPS MIXED',
  colorHex: '#2DD4BF',
  startedOn: new Date('2024-12-08'),
  displayOrder: 0,
  archivedAt: null,
  createdAt: new Date('2026-07-01T00:00:00Z'),
  updatedAt: new Date('2026-07-01T00:00:00Z'),
  waterLogs: [
    {
      id: 'seed-waterlog-latest',
      tankId: 'seed-tank-main',
      measuredAt: new Date('2026-07-30T13:30:00Z'),
      note: '換水後複測',
      createdAt: new Date('2026-07-30T13:31:00Z'),
      updatedAt: new Date('2026-07-30T13:31:00Z'),
      readings: [
        {
          id: 'seed-reading-kh',
          waterLogId: 'seed-waterlog-latest',
          parameter: 'KH',
          value: 7.8,
          createdAt: new Date('2026-07-30T13:31:00Z'),
          updatedAt: new Date('2026-07-30T13:31:00Z'),
        },
      ],
    },
  ],
  waterTargets: [
    {
      id: 'seed-target-kh',
      tankId: 'seed-tank-main',
      parameter: 'KH',
      minValue: 7,
      maxValue: 9,
      createdAt: new Date('2026-07-01T00:00:00Z'),
      updatedAt: new Date('2026-07-01T00:00:00Z'),
    },
  ],
  creatures: [
    {
      id: 'seed-creature-05',
      tankId: 'seed-tank-main',
      name: '六線龍',
      scientificName: 'Pseudocheilinus hexataenia',
      category: 'FISH',
      subCategory: '龍魚',
      photoUrl: null,
      addedOn: new Date('2025-11-12'),
      price: 900,
      status: 'DEAD',
      observedSickOn: new Date('2026-05-16'),
      ailment: null,
      diedOn: new Date('2026-05-20'),
      causeOfDeath: 'JUMPED',
      deathNote: '半夜跳出主缸，早上發現已乾。',
      createdAt: new Date('2026-07-01T00:00:00Z'),
      updatedAt: new Date('2026-07-01T00:00:00Z'),
    },
  ],
  maintenanceTasks: [
    {
      id: 'seed-task-01',
      tankId: 'seed-tank-main',
      name: '換水 10%',
      intervalDays: 7,
      startOn: new Date('2026-05-02'),
      isActive: true,
      displayOrder: 0,
      note: null,
      createdAt: new Date('2026-07-01T00:00:00Z'),
      updatedAt: new Date('2026-07-01T00:00:00Z'),
      completions: [
        {
          id: 'seed-completion-01',
          taskId: 'seed-task-01',
          completedAt: new Date('2026-07-25T00:20:00Z'),
          completedOn: new Date('2026-07-25'),
          note: null,
          createdAt: new Date('2026-07-25T00:20:00Z'),
          updatedAt: new Date('2026-07-25T00:20:00Z'),
        },
      ],
    },
  ],
}

/** 已封存的缸（seed 也有一個）。複製後仍該是封存狀態，不能變成訪客的第三個現役缸。 */
const ARCHIVED_TANK = {
  ...TEMPLATE_TANK,
  id: 'seed-tank-archived',
  name: '舊缸',
  displayOrder: 2,
  archivedAt: new Date('2026-07-01T00:00:00Z'),
  waterLogs: [],
  waterTargets: [],
  creatures: [],
  maintenanceTasks: [],
}

const GUEST_USER_ID = 'guest-user-1'

function fakeClient(tanks: unknown[] = [TEMPLATE_TANK]) {
  let created = 0

  const client = {
    tank: {
      findMany: vi.fn().mockResolvedValue(tanks),
      create: vi.fn(async () => ({ id: `copied-tank-${++created}` })),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    },
    user: { update: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    waterLog: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    creature: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    maintenanceTask: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  }

  return client as unknown as Prisma.TransactionClient & typeof client
}

/** 巢狀 create 的一列：內容欄位任意，下層關聯以 `{ create: [...] }` 掛著 */
type CopiedRow = Record<string, unknown> & {
  readings: { create: Array<Record<string, unknown>> }
  completions: { create: Array<Record<string, unknown>> }
}

interface CopiedTank extends Record<string, unknown> {
  userId: string
  waterLogs: { create: CopiedRow[] }
  waterTargets: { create: Array<Record<string, unknown>> }
  creatures: { create: CopiedRow[] }
  maintenanceTasks: { create: CopiedRow[] }
}

/** 第 n 次 tank.create 收到的 data */
function createdTank(client: ReturnType<typeof fakeClient>, index = 0): CopiedTank {
  const [args] = client.tank.create.mock.calls[index] as unknown as [{ data: CopiedTank }]

  return args.data
}

/** 深走一個巢狀 create 結構，收集所有的 [key, value]。 */
function entriesDeep(value: unknown): Array<[string, unknown]> {
  if (Array.isArray(value)) {
    return value.flatMap(entriesDeep)
  }

  if (value instanceof Date || typeof value !== 'object' || value === null) {
    return []
  }

  return Object.entries(value).flatMap(([key, child]) => [
    [key, child] as [string, unknown],
    ...entriesDeep(child),
  ])
}

// Given 我從未以訪客身分進站 / When 我按下「以訪客身分瀏覽」
// Then（第三條）把示範資料模板的內容複製一份掛在我名下
describe('copyTemplateSandbox — 複製的來源與歸屬', () => {
  it('來源是模板使用者名下的缸', async () => {
    const client = fakeClient()

    await copyTemplateSandbox(client, GUEST_USER_ID)

    const [args] = client.tank.findMany.mock.calls[0] as unknown as [{ where: { userId: string } }]

    expect(args.where.userId).toBe(TEMPLATE_USER.id)
  })

  it('模板有幾個缸就複製幾個，每一個都掛在訪客名下', async () => {
    const client = fakeClient([TEMPLATE_TANK, ARCHIVED_TANK])

    await copyTemplateSandbox(client, GUEST_USER_ID)

    expect(client.tank.create).toHaveBeenCalledTimes(2)

    for (let index = 0; index < 2; index += 1) {
      expect(createdTank(client, index).userId).toBe(GUEST_USER_ID)
      expect(createdTank(client, index).userId).not.toBe(TEMPLATE_USER.id)
    }
  })

  // Story ④：訪客 A 改了自己沙盒裡的資料，之後進站的訪客 C 仍該拿到乾淨的示範資料。
  // 複製是「只讀模板、只寫新的一份」，所以模板上不該有任何寫入。
  it('全程不寫回模板：沒有任何 update / delete / upsert', async () => {
    const client = fakeClient([TEMPLATE_TANK, ARCHIVED_TANK])

    await copyTemplateSandbox(client, GUEST_USER_ID)

    const writes = [
      client.tank.update, client.tank.updateMany, client.tank.delete,
      client.tank.deleteMany, client.tank.upsert,
      client.user.update, client.user.delete, client.user.deleteMany,
      client.waterLog.update, client.waterLog.deleteMany,
      client.creature.update, client.creature.deleteMany,
      client.maintenanceTask.update, client.maintenanceTask.deleteMany,
    ]

    for (const write of writes) {
      expect(write).not.toHaveBeenCalled()
    }
  })

  // 下層一律靠巢狀寫入接上新的父列。各自 create 的話，外鍵只能自己填，
  // 而手上唯一有的外鍵就是模板那一列的 id——這正是最容易寫成「掛回模板」的地方。
  it('下層資料只走巢狀寫入，不各自 create', async () => {
    const client = fakeClient([TEMPLATE_TANK])

    await copyTemplateSandbox(client, GUEST_USER_ID)

    expect(client.waterLog.create).not.toHaveBeenCalled()
    expect(client.creature.create).not.toHaveBeenCalled()
    expect(client.maintenanceTask.create).not.toHaveBeenCalled()
  })
})

// issue 的複製鏈：「新 id 一律由 cuid() 產生，不可沿用模板的固定 id」
describe('copyTemplateSandbox — 不沿用模板的識別欄位', () => {
  it('複製出去的資料完全沒有 id 欄位，改由 cuid() 產生', async () => {
    const client = fakeClient([TEMPLATE_TANK, ARCHIVED_TANK])

    await copyTemplateSandbox(client, GUEST_USER_ID)

    for (let index = 0; index < 2; index += 1) {
      const keys = entriesDeep(createdTank(client, index)).map(([key]) => key)

      expect(keys).not.toContain('id')
    }
  })

  // 兩位訪客拿到的是各自的缸。模板 id 一旦跟著複製過去，第二位訪客不是撞主鍵就是
  // 直接改到第一位的資料。
  it('不帶入模板任何一列的固定 id', async () => {
    const client = fakeClient([TEMPLATE_TANK])

    await copyTemplateSandbox(client, GUEST_USER_ID)

    const values = entriesDeep(createdTank(client)).map(([, value]) => value)
    const templateIds = [
      TEMPLATE_TANK.id,
      TEMPLATE_TANK.waterLogs[0]!.id,
      TEMPLATE_TANK.waterLogs[0]!.readings[0]!.id,
      TEMPLATE_TANK.waterTargets[0]!.id,
      TEMPLATE_TANK.creatures[0]!.id,
      TEMPLATE_TANK.maintenanceTasks[0]!.id,
      TEMPLATE_TANK.maintenanceTasks[0]!.completions[0]!.id,
    ]

    for (const id of templateIds) {
      expect(values).not.toContain(id)
    }
  })

  // createdAt / updatedAt 跟著複製的話，訪客的沙盒會宣稱自己是幾個月前建立的
  it('不帶入模板的 createdAt / updatedAt，讓資料庫重新產生', async () => {
    const client = fakeClient([TEMPLATE_TANK])

    await copyTemplateSandbox(client, GUEST_USER_ID)

    const keys = entriesDeep(createdTank(client)).map(([key]) => key)

    expect(keys).not.toContain('createdAt')
    expect(keys).not.toContain('updatedAt')
  })

  // 外鍵一律由 nested create 接起來，不能沿用模板那一列的值
  it('不帶入模板的外鍵（tankId / waterLogId / taskId）', async () => {
    const client = fakeClient([TEMPLATE_TANK])

    await copyTemplateSandbox(client, GUEST_USER_ID)

    const keys = entriesDeep(createdTank(client)).map(([key]) => key)

    for (const foreignKey of ['tankId', 'waterLogId', 'taskId']) {
      expect(keys).not.toContain(foreignKey)
    }
  })
})

// issue 列出的複製鏈：Tank → WaterLog → WaterReading／WaterParameterTarget／
// Creature／MaintenanceTask → MaintenanceCompletion
describe('copyTemplateSandbox — 複製鏈的每一層', () => {
  it('Tank 的內容欄位照抄', async () => {
    const client = fakeClient()

    await copyTemplateSandbox(client, GUEST_USER_ID)

    expect(createdTank(client)).toMatchObject({
      name: '主缸',
      sizeSpec: '4 尺',
      volumeLiters: 420,
      setupType: 'SPS MIXED',
      colorHex: '#2DD4BF',
      startedOn: TEMPLATE_TANK.startedOn,
      displayOrder: 0,
    })
  })

  // 封存的缸複製後仍是封存的：seed 的「舊缸」存在的理由就是「切換選單不顯示它」，
  // 漏了 archivedAt 會讓訪客的沙盒多出一個模板裡看不到的現役缸。
  it('已封存的缸複製後仍是封存狀態', async () => {
    const client = fakeClient([ARCHIVED_TANK])

    await copyTemplateSandbox(client, GUEST_USER_ID)

    expect(createdTank(client).archivedAt).toEqual(ARCHIVED_TANK.archivedAt)
  })

  it('WaterLog 與其下的 WaterReading 掛在同一次巢狀寫入', async () => {
    const client = fakeClient()

    await copyTemplateSandbox(client, GUEST_USER_ID)

    const [log] = createdTank(client).waterLogs.create

    expect(log).toMatchObject({
      measuredAt: TEMPLATE_TANK.waterLogs[0]!.measuredAt,
      note: '換水後複測',
    })
    expect(log.readings.create).toEqual([{ parameter: 'KH', value: 7.8 }])
  })

  it('WaterParameterTarget 照抄', async () => {
    const client = fakeClient()

    await copyTemplateSandbox(client, GUEST_USER_ID)

    expect(createdTank(client).waterTargets.create).toEqual([
      { parameter: 'KH', minValue: 7, maxValue: 9 },
    ])
  })

  it('Creature 連死亡記錄一起照抄', async () => {
    const client = fakeClient()

    await copyTemplateSandbox(client, GUEST_USER_ID)

    const [creature] = createdTank(client).creatures.create

    expect(creature).toMatchObject({
      name: '六線龍',
      scientificName: 'Pseudocheilinus hexataenia',
      category: 'FISH',
      subCategory: '龍魚',
      addedOn: TEMPLATE_TANK.creatures[0]!.addedOn,
      price: 900,
      status: 'DEAD',
      observedSickOn: TEMPLATE_TANK.creatures[0]!.observedSickOn,
      diedOn: TEMPLATE_TANK.creatures[0]!.diedOn,
      causeOfDeath: 'JUMPED',
      deathNote: '半夜跳出主缸，早上發現已乾。',
    })
  })

  it('MaintenanceTask 與其下的 MaintenanceCompletion 一起照抄', async () => {
    const client = fakeClient()

    await copyTemplateSandbox(client, GUEST_USER_ID)

    const [task] = createdTank(client).maintenanceTasks.create

    expect(task).toMatchObject({
      name: '換水 10%',
      intervalDays: 7,
      startOn: TEMPLATE_TANK.maintenanceTasks[0]!.startOn,
      isActive: true,
      displayOrder: 0,
    })
    expect(task.completions.create).toEqual([
      {
        completedAt: TEMPLATE_TANK.maintenanceTasks[0]!.completions[0]!.completedAt,
        completedOn: TEMPLATE_TANK.maintenanceTasks[0]!.completions[0]!.completedOn,
        note: null,
      },
    ])
  })
})

// 模板還沒 seed（例如一個全新的資料庫）時，訪客仍要能進站——沙盒是空的，
// 首頁走的是既有的「還沒有缸」空狀態，不是一頁 500。
describe('copyTemplateSandbox — 模板不存在', () => {
  /** 這一段刻意會叫 console.warn，測試裡收掉才不會把輸出洗成一片黃 */
  const silencedWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {})

  it('模板沒有任何缸時不寫入，也不拋錯', async () => {
    const warn = silencedWarn()
    const client = fakeClient([])

    await expect(copyTemplateSandbox(client, GUEST_USER_ID)).resolves.toBe(0)
    expect(client.tank.create).not.toHaveBeenCalled()

    warn.mockRestore()
  })

  // 這件事實際發生過：#78 merge 之後 preview 上按訪客按鈕進去是空畫面，而 server 端
  // 一個字都沒說。原因是那個資料庫從 #72（模板改名）之後就沒再 seed 過，缸還掛在舊的
  // seed-user-kathryn 名下——查 seed-user-template 自然是 0 個缸。
  //
  // 「複製 0 個缸」本身是合法路徑（全新的資料庫也會走到，訪客照樣要進得去），所以不能
  // 拋錯。但它同時也是「模板沒 seed」唯一的徵兆，靜默的話下次只能從頭查一遍。
  it('模板沒有任何缸時留下警告，並指出該跑 seed', async () => {
    const warn = silencedWarn()

    await copyTemplateSandbox(fakeClient([]), GUEST_USER_ID)

    expect(warn).toHaveBeenCalledTimes(1)

    const message = warn.mock.calls[0]!.join(' ')

    // 訊息要能直接告訴看 log 的人下一步做什麼，而不是只說「有 0 個缸」
    expect(message).toContain('db:seed')
    expect(message).toContain(TEMPLATE_USER.id)

    warn.mockRestore()
  })

  it('模板有缸時不留警告', async () => {
    const warn = silencedWarn()

    await copyTemplateSandbox(fakeClient([TEMPLATE_TANK]), GUEST_USER_ID)

    expect(warn).not.toHaveBeenCalled()

    warn.mockRestore()
  })
})
