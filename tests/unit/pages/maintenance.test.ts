import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import MaintenancePage from '../../../app/pages/maintenance/index.vue'
import { signedInUserSession } from '../support/session'
import type { TankOption } from '#shared/types/home'
import type { MaintenanceCompletionDto, MaintenanceTaskDto } from '#shared/types/maintenance'
import { addDays, toLocalDateOnly } from '#shared/utils/maintenance'
import { formatMaintenanceDate } from '#shared/utils/maintenanceView'

// 保養提醒頁（screen-7，issue #125 ＝ #15 的畫面那一半）。
//
// 資料那一半（GET /api/tanks/:id/maintenance 與勾選 / 取消兩支）已由 PR #136 合併，
// 分區與徽章的推算住在 #shared/utils/maintenance（由 tests/unit/shared/maintenance.test.ts
// 守著）。這裡驗的是畫面有沒有照著串：分對區、勾得動、失敗回捲、載入中不閃空狀態。
//
// 這一頁要登入才進得去（#67 的全域路由保護）。少了這張 session，
// mountSuspended 的導覽會先被導去 /login。
mockNuxtImport('useUserSession', () => () => signedInUserSession())

const MAIN_TANK: TankOption = {
  id: 'tank-1',
  name: '主缸',
  sizeSpec: '4 尺',
  volumeLiters: 420,
  setupType: 'SPS MIXED',
  colorHex: '#2dd4bf',
}

/**
 * 夾具的日期全部由「今天」往前後推。
 *
 * 寫死日期的話，同一份程式碼會在某一天自己紅掉——`buildMaintenanceSections` 分區看的
 * 是使用者當地的今天，而頁面用的是真實時鐘。這一課是 PR #138 踩出來的
 * （water-log.spec.ts 寫死「七天前」，隔天全紅）。
 */
const TODAY = toLocalDateOnly(new Date())

/** 某天某個鐘點做完的那一筆。時間取當地的牆上時間，副標的「已完成 08:20」就是它 */
function completion(dateOnly: string, hours: number, minutes: number): MaintenanceCompletionDto {
  const [year, month, day] = dateOnly.split('-').map(Number) as [number, number, number]

  return {
    completedAt: new Date(year, month - 1, day, hours, minutes).toISOString(),
    completedOn: dateOnly,
  }
}

function task(overrides: Partial<MaintenanceTaskDto> & { id: string, name: string }): MaintenanceTaskDto {
  return {
    intervalDays: 7,
    startOn: null,
    createdOn: addDays(TODAY, -90),
    displayOrder: 0,
    isActive: true,
    lastCompletion: null,
    ...overrides,
  }
}

/**
 * 示範用的五個任務，剛好把兩區與三種樣態都佔滿：
 *   換水 10%   每 7 天、7 天前做過  → 今天到期
 *   餵食       每天、今天 08:20 做過 → 今天該做（已完成）
 *   折射計校正 每 30 天、33 天前做過 → 逾期 3 天
 *   洗濾材     每 30 天、16 天前做過 → 14 天後
 *   洗前置棉   每 7 天、4 天前做過   → 3 天後
 *
 * 「洗濾材」的 displayOrder 刻意排在「洗前置棉」前面：即將到期區要依到期日由近到遠，
 * 照著 API 給的順序渲染的話這一題會過不了。
 */
function demoTasks(): MaintenanceTaskDto[] {
  return [
    task({ id: 'task-water', name: '換水 10%', intervalDays: 7, displayOrder: 0, lastCompletion: completion(addDays(TODAY, -7), 9, 0) }),
    task({ id: 'task-feed', name: '餵食', intervalDays: 1, displayOrder: 1, lastCompletion: completion(TODAY, 8, 20) }),
    task({ id: 'task-calib', name: '折射計校正', intervalDays: 30, displayOrder: 2, lastCompletion: completion(addDays(TODAY, -33), 10, 0) }),
    task({ id: 'task-media', name: '洗濾材 / 生化球', intervalDays: 30, displayOrder: 3, lastCompletion: completion(addDays(TODAY, -16), 12, 0) }),
    task({ id: 'task-floss', name: '洗前置棉', intervalDays: 7, displayOrder: 4, lastCompletion: completion(addDays(TODAY, -4), 11, 0) }),
  ]
}

/** 把某支 API 的回應停在半路，用來驗「資料還在路上」與「請求進行中」的樣態 */
function gate() {
  let open!: () => void
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })

  return { promise, open }
}

const state = {
  /** #144 的補建被打了幾次。每一次都是一支會寫入的 API，不該重複 */
  sandboxCalls: 0,
  tanks: [] as TankOption[],
  tasks: [] as MaintenanceTaskDto[],
  hold: { get: null as ReturnType<typeof gate> | null, write: null as ReturnType<typeof gate> | null },
  // issue #132：兩支 GET 各自可以被打成 500，用來分辨「拿不到資料」與「你沒有資料」
  fail: { tanks: false, get: false },
  write: {
    posts: [] as { taskId: string, completedOn: string | undefined }[],
    deletes: [] as { taskId: string, completedOn: string }[],
    fail: false,
    failure: { statusCode: 500, statusMessage: 'Internal Server Error', message: null as string | null },
  },
}

/**
 * registerEndpoint 底下跑的是 h3 的 node listener，$fetch 送出的 body
 * 原樣掛在 node 請求物件上（node-mock-http 的行為）。
 */
interface MockNodeEvent {
  node: { req: { body?: string } }
}

/** 說不出原因的失敗（500 / 離線 / function 掛掉），沒有可以直接顯示給使用者的訊息 */
function serverError() {
  return createError({ statusCode: 500, statusMessage: 'Internal Server Error' })
}

function writeFailure() {
  // 與 server/utils/authorization.ts 同一個形狀：statusMessage 只留 ASCII，
  // 可以給使用者看的中文訊息放在 data.message
  return createError({
    statusCode: state.write.failure.statusCode,
    statusMessage: state.write.failure.statusMessage,
    data: state.write.failure.message === null ? undefined : { message: state.write.failure.message },
  })
}

function findTask(taskId: string) {
  const found = state.tasks.find(candidate => candidate.id === taskId)

  if (!found) {
    throw createError({ statusCode: 404, statusMessage: 'Maintenance task not found' })
  }

  return found
}

// 訪客沙盒的補建（issue #144）。這一頁在拿到空的缸清單時會問一次「這是準備中，
// 還是真的沒有缸」——沒有這支端點的話，那個問題永遠得不到答案，畫面會停在
// 「正在為你準備示範資料」，而所有驗空狀態的題目都會以「找不到元素」失敗。
//
// 預設 alreadySeeded: true ＝「沒有欠著的沙盒」，也就是這幾題要的前提：清單空著
// 就是真的沒有缸。訪客那條路徑由首頁的測試（home.test.ts）自己顧。
registerEndpoint('/api/guest-sandbox', {
  method: 'POST',
  handler: () => {
    state.sandboxCalls++

    return { copied: 0, alreadySeeded: true }
  },
})

registerEndpoint('/api/tanks', () => {
  if (state.fail.tanks) {
    throw serverError()
  }

  return { tanks: state.tanks }
})

registerEndpoint('/api/tanks/tank-1/maintenance', {
  method: 'GET',
  handler: async () => {
    await state.hold.get?.promise

    if (state.fail.get) {
      throw serverError()
    }

    return { tasks: state.tasks }
  },
})

// registerEndpoint 比對的是完整路徑字串（沒有 :param），所以每個任務各註冊一組。
// 取消勾選那一支的網址帶著日期，用的就是頁面會送出的那一天。
for (const { id } of demoTasks()) {
  registerEndpoint(`/api/maintenance-tasks/${id}/completions`, {
    method: 'POST',
    handler: async (event) => {
      const body = JSON.parse((event as unknown as MockNodeEvent).node.req.body ?? 'null') as { completedOn?: string } | null

      state.write.posts.push({ taskId: id, completedOn: body?.completedOn })

      await state.hold.write?.promise

      if (state.write.fail) {
        throw writeFailure()
      }

      // 兩支寫入都回「更新後的那一個任務」（MaintenanceTaskResponse），
      // 畫面因此不必為了讓分區與徽章正確而整頁重抓
      const target = findTask(id)
      const updated = {
        ...target,
        lastCompletion: { completedAt: new Date().toISOString(), completedOn: body!.completedOn! },
      }

      state.tasks = state.tasks.map(candidate => candidate.id === id ? updated : candidate)

      return { task: updated }
    },
  })

  registerEndpoint(`/api/maintenance-tasks/${id}/completions/${TODAY}`, {
    method: 'DELETE',
    handler: async () => {
      state.write.deletes.push({ taskId: id, completedOn: TODAY })

      await state.hold.write?.promise

      if (state.write.fail) {
        throw writeFailure()
      }

      // 刪掉今天那一筆之後，「最後一筆」退回前一次完成——server 回的是現況，
      // 不是 null（見 resolveClearCompletion）
      const target = findTask(id)
      const updated = { ...target, lastCompletion: completion(addDays(TODAY, -target.intervalDays), 8, 20) }

      state.tasks = state.tasks.map(candidate => candidate.id === id ? updated : candidate)

      return { task: updated }
    },
  })
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  // useAsyncData 的結果會留在 payload 上，測試之間必須清掉才不會拿到上一題的資料
  clearNuxtData()

  // 沙盒的狀態 #144 之後住在 useState（跨頁共用），不歸 clearNuxtData 管——
  // 少了這一句，上一題問完之後的 'settled' 會讓下一題連問都不問
  clearNuxtState()
  state.sandboxCalls = 0

  state.tanks = [MAIN_TANK]
  state.tasks = demoTasks()
  state.hold = { get: null, write: null }
  state.fail = { tanks: false, get: false }
  state.write.posts = []
  state.write.deletes = []
  state.write.fail = false
  state.write.failure = { statusCode: 500, statusMessage: 'Internal Server Error', message: null }
})

type Page = Awaited<ReturnType<typeof mountSuspended>>

/**
 * 這一頁的載入是兩段串起來的（先問有哪些缸，再問那個缸的保養任務），
 * 所以要 flush 兩輪才輪得到第二段的回應。
 */
async function settle() {
  await flushPromises()
  await flushPromises()
  // #144：拿到空的缸清單時這一頁會問一次「這是準備中，還是真的沒有缸」，
  // 答案回來之前畫面停在「正在為你準備示範資料」
  await flushPromises()
}

async function open() {
  const page = await mountSuspended(MaintenancePage, { route: '/maintenance' })

  await settle()

  return page
}

const todayIds = (page: Page) =>
  page.findAll('[data-testid="today-row"]').map(row => row.attributes('data-task-id'))

const upcomingIds = (page: Page) =>
  page.findAll('[data-testid="upcoming-row"]').map(row => row.attributes('data-task-id'))

const badge = (page: Page) => page.get('[data-testid="today-badge"]').text()

function todayRow(page: Page, taskId: string) {
  return page.get(`[data-testid="today-row"][data-task-id="${taskId}"]`)
}

async function toggle(page: Page, taskId: string) {
  await todayRow(page, taskId).get('[data-testid="task-checkbox"]').trigger('click')
  await settle()
}

describe('保養提醒 — 頁首', () => {
  // Given 我進入「保養」頁 / When 畫面載入
  // Then 頁首顯示「保養提醒」與副標「<缸名> · N 月 N 日 週X」
  it('顯示標題與「<缸名> · N 月 N 日 週X」副標', async () => {
    const page = await open()

    expect(page.get('h1').text()).toBe('保養提醒')
    expect(page.get('[data-testid="maintenance-subtitle"]').text())
      .toBe(`主缸 · ${formatMaintenanceDate(new Date())}`)
  })

  // And 畫面分為「今天該做」與「即將到期」兩區
  it('分成「今天該做」與「即將到期」兩區', async () => {
    const page = await open()

    expect(page.get('[data-testid="today-section"]').text()).toContain('今天該做')
    expect(page.get('[data-testid="upcoming-section"]').text()).toContain('即將到期')
  })

  // Given 我正在查看保養提醒 / Then 頁首提供不被勾選狀態影響的新增入口
  it('頁首新增按鈕連到新增任務表單', async () => {
    const page = await open()
    const add = page.get('[data-testid="maintenance-add"]')

    expect(add.attributes('href')).toBe('/maintenance/tasks/new')
    expect(add.attributes('disabled')).toBeUndefined()
    expect(add.attributes('aria-label')).toBe('新增保養任務')
  })

  // Given 清單同時有今天與即將到期的任務 / Then 每列有自己的編輯入口
  it('今天與即將到期的每列都有獨立編輯連結', async () => {
    const page = await open()

    expect(todayRow(page, 'task-water').get('[data-testid="maintenance-edit"]').attributes('href'))
      .toBe('/maintenance/tasks/task-water/edit')
    expect(page.get('[data-testid="upcoming-row"][data-task-id="task-floss"]')
      .get('[data-testid="maintenance-edit"]').attributes('href'))
      .toBe('/maintenance/tasks/task-floss/edit')
  })
})

describe('保養提醒 — 今天該做', () => {
  // Given 某任務「換水 10%」每 7 天一次、上次完成於 07/01，今天是 07/08
  // Then 該任務出現在「今天該做」區，副標為「每 7 天 · 上次 07/01」，右側顯示「今天」
  it('今天到期的任務在「今天該做」區，副標與右側狀態都對', async () => {
    const page = await open()
    const row = todayRow(page, 'task-water')
    const lastDone = addDays(TODAY, -7)

    expect(row.get('[data-testid="task-name"]').text()).toBe('換水 10%')
    expect(row.get('[data-testid="task-subtitle"]').text())
      .toBe(`每 7 天 · 上次 ${lastDone.slice(5, 7)}/${lastDone.slice(8, 10)}`)
    expect(row.get('[data-testid="task-status"]').text()).toBe('今天')
  })

  // And 「今天該做」標題旁的數字徽章反映未完成的任務數
  it('徽章數字是今天該做之中尚未完成的數量', async () => {
    const page = await open()

    // 換水（今天到期）與折射計校正（逾期）兩個；今天已完成的餵食不算
    expect(todayIds(page)).toEqual(['task-calib', 'task-water', 'task-feed'])
    expect(badge(page)).toBe('2')
  })

  // Given 某任務已逾期（下次到期日早於今天）
  // Then 該任務仍出現在「今天該做」區，並以逾期樣式標示天數
  it('逾期的任務留在「今天該做」區並標示逾期天數', async () => {
    const page = await open()
    const row = todayRow(page, 'task-calib')

    expect(row.attributes('data-overdue')).toBe('true')
    // 只把字變紅的話色覺障礙者讀不到，所以天數本身要寫出來
    expect(row.get('[data-testid="task-status"]').text()).toBe('逾期 3 天')
  })

  // Given 「餵食」為每天一次且我今天已完成於 08:20
  // Then 該任務顯示已勾選的 checkbox、文字降透明度，副標為「每天 · 已完成 08:20」
  it('今天已完成的任務：已勾選、降透明度、副標寫著完成時間', async () => {
    const page = await open()
    const row = todayRow(page, 'task-feed')

    expect(row.get('[data-testid="task-checkbox"]').attributes('aria-checked')).toBe('true')
    expect(row.classes().join(' ')).toContain('opacity')
    expect(row.get('[data-testid="task-subtitle"]').text()).toBe('每天 · 已完成 08:20')
  })

  // And 它仍留在「今天該做」區，不因為做完了就跳到「即將到期」
  it('今天已完成的任務不跳到「即將到期」', async () => {
    const page = await open()

    expect(todayIds(page)).toContain('task-feed')
    expect(upcomingIds(page)).not.toContain('task-feed')
  })
})

describe('保養提醒 — 即將到期', () => {
  // Given 「洗前置棉」每 7 天、下次到期為 7/11；「洗濾材 / 生化球」每 30 天、下次到期為 7/22
  // Then 兩者出現在「即將到期」區，依到期日由近到遠排序
  it('依到期日由近到遠，不照 API 給的順序', async () => {
    const page = await open()

    // API 回的順序是 displayOrder（洗濾材在洗前置棉之前），畫面要重排
    expect(state.tasks.map(item => item.id)).toContain('task-media')
    expect(upcomingIds(page)).toEqual(['task-floss', 'task-media'])
  })

  // And 每列左側顯示到期日的日 / 月方塊，右側顯示「N 天後」
  it('每列有日 / 月方塊與「N 天後」', async () => {
    const page = await open()
    const row = page.get('[data-testid="upcoming-row"][data-task-id="task-floss"]')
    const due = addDays(TODAY, 3)

    expect(row.get('[data-testid="due-day"]').text()).toBe(due.slice(8, 10))
    expect(row.get('[data-testid="due-month"]').text()).toBe(`${Number(due.slice(5, 7))}月`)
    expect(row.get('[data-testid="due-in"]').text()).toBe('3 天後')
  })

  // 4-2：提前打勾會讓 nextDueOn 整條往後推，而畫面上沒有地方能解釋那個跳動
  it('這一區沒有 checkbox', async () => {
    const page = await open()

    expect(page.get('[data-testid="upcoming-section"]').findAll('[data-testid="task-checkbox"]')).toHaveLength(0)
  })
})

describe('保養提醒 — 勾選', () => {
  // Given 「換水 10%」在今天該做清單中且未完成 / When 我點擊它的 checkbox
  // Then 新增一筆今天的完成紀錄，該列即時轉為已完成樣式並顯示完成時間
  it('勾選後送出今天的完成紀錄，該列轉為已完成', async () => {
    const page = await open()

    await toggle(page, 'task-water')

    expect(state.write.posts).toEqual([{ taskId: 'task-water', completedOn: TODAY }])

    const row = todayRow(page, 'task-water')

    expect(row.get('[data-testid="task-checkbox"]').attributes('aria-checked')).toBe('true')
    expect(row.get('[data-testid="task-subtitle"]').text()).toMatch(/^每 7 天 · 已完成 \d{2}:\d{2}$/)
  })

  // And 徽章數字減一
  it('勾選後徽章數字減一', async () => {
    const page = await open()

    expect(badge(page)).toBe('2')

    await toggle(page, 'task-water')

    expect(badge(page)).toBe('1')
  })

  // 它仍留在「今天該做」區——只照 nextDueOn 分區的話，勾起來的那一列會當場
  // 跳到「即將到期」，等於畫面在懲罰使用者完成任務
  it('勾選後那一列仍在「今天該做」區', async () => {
    const page = await open()

    await toggle(page, 'task-water')

    expect(todayIds(page)).toContain('task-water')
    expect(upcomingIds(page)).not.toContain('task-water')
  })

  // 樂觀更新：勾一個 checkbox 卻要等網路來回才有反應，在手機上感覺就像沒按到
  it('請求還在路上時該列就已經是已完成樣式', async () => {
    state.hold.write = gate()

    const page = await open()

    // 刻意不 await：要看的正是請求還沒回來的那一拍
    void todayRow(page, 'task-water').get('[data-testid="task-checkbox"]').trigger('click')
    await flushPromises()

    expect(todayRow(page, 'task-water').get('[data-testid="task-checkbox"]').attributes('aria-checked')).toBe('true')
    expect(badge(page)).toBe('1')

    state.hold.write.open()
    await settle()

    expect(todayRow(page, 'task-water').get('[data-testid="task-checkbox"]').attributes('aria-checked')).toBe('true')
  })

  // Given 「餵食」今天已完成 / When 我再次點擊它的 checkbox（取消勾選）
  // Then 刪除今天那一筆完成紀錄，該列回到未完成樣式
  it('取消勾選會刪掉今天那一筆，該列回到未完成', async () => {
    const page = await open()

    await toggle(page, 'task-feed')

    expect(state.write.deletes).toEqual([{ taskId: 'task-feed', completedOn: TODAY }])

    const row = todayRow(page, 'task-feed')

    expect(row.get('[data-testid="task-checkbox"]').attributes('aria-checked')).toBe('false')
    expect(row.get('[data-testid="task-subtitle"]').text()).not.toContain('已完成')
    expect(badge(page)).toBe('3')
  })
})

describe('保養提醒 — 連點與失敗', () => {
  // Given 我在網路不穩時連續點擊同一個 checkbox 兩次 / When 請求送出
  // Then 該任務今天最多只會有一筆完成紀錄，不產生重複履歷
  it('連點兩次只送出一次請求', async () => {
    state.hold.write = gate()

    const page = await open()

    const checkbox = () => todayRow(page, 'task-water').get('[data-testid="task-checkbox"]')

    void checkbox().trigger('click')
    await flushPromises()
    void checkbox().trigger('click')
    await flushPromises()

    expect(state.write.posts).toHaveLength(1)
    // 第一道防線是「處理中整列按不動」（第二道是資料庫的 @@unique([taskId, completedOn])）
    expect(checkbox().attributes('disabled')).toBeDefined()

    state.hold.write.open()
    await settle()

    // And 畫面不會停在「兩個請求互相覆蓋」出來的錯誤狀態
    expect(state.write.posts).toHaveLength(1)
    expect(todayRow(page, 'task-water').find('[data-testid="task-error"]').exists()).toBe(false)
    expect(checkbox().attributes('aria-checked')).toBe('true')
    expect(checkbox().attributes('disabled')).toBeUndefined()
  })

  // Given 勾選的請求失敗（網路中斷、500）/ When 我看到結果
  // Then 該列回到點擊前的樣子並顯示錯誤，而不是留在一個假的已完成狀態
  it('勾選失敗時該列回到點擊前的樣子並顯示錯誤', async () => {
    state.write.fail = true

    const page = await open()

    await toggle(page, 'task-water')

    const row = todayRow(page, 'task-water')

    expect(row.get('[data-testid="task-checkbox"]').attributes('aria-checked')).toBe('false')
    expect(row.get('[data-testid="task-subtitle"]').text()).toContain('上次')
    expect(row.get('[data-testid="task-error"]').text()).not.toBe('')
    expect(badge(page)).toBe('2')
  })

  // 錯誤講在那一列旁邊，不是整頁的錯誤區塊——「一列沒勾成功」不等於「整頁壞了」
  it('失敗時不把整頁畫成載入失敗', async () => {
    state.write.fail = true

    const page = await open()

    await toggle(page, 'task-water')

    expect(page.find('[data-testid="load-error"]').exists()).toBe(false)
    expect(todayIds(page)).toHaveLength(3)
  })

  // server 說得出原因時（例如「只能勾選今天的保養。」）原樣顯示那一句
  it('原樣顯示 server 給的訊息', async () => {
    state.write.fail = true
    state.write.failure = { statusCode: 400, statusMessage: 'Invalid completedOn', message: '只能勾選今天的保養。' }

    const page = await open()

    await toggle(page, 'task-water')

    expect(todayRow(page, 'task-water').get('[data-testid="task-error"]').text()).toBe('只能勾選今天的保養。')
  })

  it('失敗之後再按一次可以重試', async () => {
    state.write.fail = true

    const page = await open()

    await toggle(page, 'task-water')

    state.write.fail = false

    await toggle(page, 'task-water')

    expect(state.write.posts).toHaveLength(2)
    expect(todayRow(page, 'task-water').get('[data-testid="task-checkbox"]').attributes('aria-checked')).toBe('true')
    expect(todayRow(page, 'task-water').find('[data-testid="task-error"]').exists()).toBe(false)
  })

  // 取消勾選失敗時同樣回捲：回到「已完成」而不是留在一個假的未完成狀態
  it('取消勾選失敗時該列回到已完成', async () => {
    state.write.fail = true

    const page = await open()

    await toggle(page, 'task-feed')

    const row = todayRow(page, 'task-feed')

    expect(row.get('[data-testid="task-checkbox"]').attributes('aria-checked')).toBe('true')
    expect(row.get('[data-testid="task-subtitle"]').text()).toBe('每天 · 已完成 08:20')
    expect(row.get('[data-testid="task-error"]').text()).not.toBe('')
  })
})

describe('保養提醒 — 停用的任務', () => {
  // Given 某任務被停用（isActive 為 false）/ Then 該任務不出現在任何一區
  //
  // server 已經濾掉（GET 只回 isActive 的任務），所以這裡驗的是畫面沒有自己又加回來：
  // 渲染出來的列必須與 API 回的那一份一模一樣，不多也不少。
  it('畫面只渲染 API 回的任務，沒有多出別的來源', async () => {
    state.tasks = demoTasks().filter(item => item.id !== 'task-media')

    const page = await open()

    expect([...todayIds(page), ...upcomingIds(page)].sort())
      .toEqual(state.tasks.map(item => item.id).sort())
    expect(page.text()).not.toContain('洗濾材')
  })
})

describe('保養提醒 — 空狀態', () => {
  // Given 該缸沒有任何保養任務 / Then 兩區皆顯示空狀態文案並引導我新增第一個任務
  //
  // 4-4：用「一則」空狀態而不是兩則——兩區各一則疊在一起像是壞掉了
  it('一個任務都沒有時只出現一則空狀態，並引導新增第一個任務', async () => {
    state.tasks = []

    const page = await open()

    const empty = page.findAll('[data-testid="maintenance-empty"]')

    expect(empty).toHaveLength(1)
    expect(empty[0]!.text()).toContain('第一個')
    expect(todayIds(page)).toHaveLength(0)
    expect(upcomingIds(page)).toHaveLength(0)
  })

  // 4-1 既然不渲染 ＋ 按鈕，空狀態這裡也就只有文字、沒有按不動的入口
  it('空狀態提供新增第一個任務的入口', async () => {
    state.tasks = []

    const page = await open()
    const action = page.get('[data-testid="maintenance-empty-add"]')

    expect(action.attributes('href')).toBe('/maintenance/tasks/new')
    expect(action.text()).toContain('新增第一個任務')
  })

  // 4-4：「今天該做」空、「即將到期」有東西是正常且常見的，這時那一區給一句短句就好，
  // 不要整區消失，也不要因此擺出「你還沒有任何保養任務」
  it('今天沒有待辦但即將到期有東西時，今天該做區留著一句短句', async () => {
    state.tasks = demoTasks().filter(item => ['task-media', 'task-floss'].includes(item.id))

    const page = await open()

    expect(page.get('[data-testid="today-section"]').exists()).toBe(true)
    expect(page.get('[data-testid="today-empty"]').text()).not.toBe('')
    expect(badge(page)).toBe('0')
    expect(page.find('[data-testid="maintenance-empty"]').exists()).toBe(false)
    expect(upcomingIds(page)).toEqual(['task-floss', 'task-media'])
  })
})

describe('保養提醒 — 資料還在路上', () => {
  // Given 資料還在路上（#84 之後是 SPA，首屏沒有伺服器算好的畫面）
  // Then 顯示載入樣態，不得先閃一次空狀態
  it('載入中顯示載入樣態，不先閃空狀態', async () => {
    state.hold.get = gate()

    const page = await open()

    expect(page.get('[data-testid="maintenance-loading"]').exists()).toBe(true)
    expect(page.find('[data-testid="maintenance-empty"]').exists()).toBe(false)
    expect(page.find('[data-testid="today-empty"]').exists()).toBe(false)
    expect(page.find('[data-testid="tank-empty"]').exists()).toBe(false)

    state.hold.get.open()
    await settle()

    expect(page.find('[data-testid="maintenance-loading"]').exists()).toBe(false)
    expect(todayIds(page)).toEqual(['task-calib', 'task-water', 'task-feed'])
  })
})

describe('保養提醒 — 取資料失敗', () => {
  // Given 請求失敗 / When 畫面渲染
  // Then 顯示「載入失敗」與重試，而不是畫成「你還沒有任何保養任務」（#132 / #133）
  it('保養任務回 500 時顯示載入失敗與重試，不是空狀態', async () => {
    state.fail.get = true

    const page = await open()

    expect(page.get('[data-testid="load-error"]').text()).toContain('載入失敗')
    expect(page.get('[data-testid="load-error-retry"]').exists()).toBe(true)
    expect(page.find('[data-testid="maintenance-empty"]').exists()).toBe(false)
    expect(page.find('[data-testid="today-section"]').exists()).toBe(false)
  })

  it('缸清單回 500 時同樣顯示載入失敗，不是「還沒有任何缸」', async () => {
    state.fail.tanks = true

    const page = await open()

    expect(page.get('[data-testid="load-error"]').exists()).toBe(true)
    expect(page.find('[data-testid="tank-empty"]').exists()).toBe(false)
  })

  it('點「重試」重新發出請求，成功後正常顯示', async () => {
    state.fail.get = true

    const page = await open()

    expect(page.get('[data-testid="load-error"]').exists()).toBe(true)

    state.fail.get = false

    await page.get('[data-testid="load-error-retry"]').trigger('click')
    await settle()

    await vi.waitFor(() => {
      expect(page.find('[data-testid="load-error"]').exists()).toBe(false)
      expect(todayIds(page)).toEqual(['task-calib', 'task-water', 'task-feed'])
    })
  })

  // 重試期間 status 會從 'error' 翻成 'pending'，「只看 error」的寫法會在那一段
  // 把錯誤區塊拆掉，畫面於是閃過一次骨架或空狀態
  it('重試進行中畫面停在載入失敗，不閃過骨架或空狀態', async () => {
    state.fail.get = true

    const page = await open()

    state.fail.get = false
    state.hold.get = gate()

    void page.get('[data-testid="load-error-retry"]').trigger('click')
    await flushPromises()

    expect(page.get('[data-testid="load-error"]').exists()).toBe(true)
    expect(page.find('[data-testid="maintenance-loading"]').exists()).toBe(false)
    expect(page.find('[data-testid="maintenance-empty"]').exists()).toBe(false)
    expect(page.get('[data-testid="load-error-retry"]').attributes('disabled')).toBeDefined()

    state.hold.get.open()

    await vi.waitFor(() => {
      expect(page.find('[data-testid="load-error"]').exists()).toBe(false)
    })
  })

  // 頁首「保養提醒」是常駐的 h1（錯誤時也留著），所以錯誤區塊的標題不能也是 h1
  it('載入失敗時整頁仍然只有一個 h1', async () => {
    state.fail.get = true

    const page = await open()

    const headings = page.findAll('h1')

    expect(headings).toHaveLength(1)
    expect(headings[0]!.text()).toBe('保養提醒')
    expect(page.get('[data-testid="load-error-title"]').text()).toBe('載入失敗')
  })
})

describe('保養提醒 — 尚未建立任何缸', () => {
  // 保養任務是記在缸底下的，沒有缸就沒有東西可提醒。整頁不能因此壞掉
  it('沒有任何缸時顯示建立缸的入口，不顯示兩區', async () => {
    state.tanks = []

    const page = await open()

    expect(page.get('[data-testid="tank-empty"]').exists()).toBe(true)
    expect(page.get('[data-testid="tank-empty-action"]').attributes('href')).toBe('/tanks/new')
    expect(page.find('[data-testid="today-section"]').exists()).toBe(false)
    expect(page.find('[data-testid="maintenance-empty"]').exists()).toBe(false)
  })
})

// issue #144：訪客的示範資料還在複製時，**這一頁也要說同一件事**。
//
// 複製要 11.5 秒，而底部的 tab 列一直都在——使用者在等待期間可以走到這裡。
// 只有首頁認得那一態的話，這裡會畫成「還沒有任何缸」，而首頁同一時間正說著
// 「正在為你準備」。實際在 preview 上踩到過。
describe('保養提醒 — 訪客沙盒準備中', () => {
  it('清單空著且還沒問到答案時，顯示「正在準備示範資料」而不是「還沒有任何缸」', async () => {
    state.tanks = []

    // 不走 open()：那個 helper 會等補建的答案回來，而這裡要看的正是「還沒回來」那一刻
    const page = await mountSuspended(MaintenancePage, { route: '/maintenance' })

    await flushPromises()

    expect(page.find('[data-testid="sandbox-preparing"]').exists()).toBe(true)
    expect(page.find('[data-testid="tank-empty"]').exists()).toBe(false)
    expect(page.find('[data-testid="tank-empty-action"]').exists()).toBe(false)
  })

  // 這一頁也要**觸發**補建：書籤直接開這裡的訪客，首頁根本沒掛載，
  // 那支 API 一次都不會被呼叫，他會永遠等不到資料。
  it('由這一頁自己去問，不必先經過首頁', async () => {
    state.tanks = []
    state.sandboxCalls = 0

    await open()

    expect(state.sandboxCalls).toBe(1)
  })
})
