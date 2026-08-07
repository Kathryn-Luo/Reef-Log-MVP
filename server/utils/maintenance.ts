import type { MaintenanceCompletion, MaintenanceTask, PrismaClient } from '@prisma/client'
import type { MaintenancePageData, MaintenanceTaskDto } from '#shared/types/maintenance'

// 保養提醒的資料層（issue #122，畫面是 #15 的 screen-7）。
//
// 這一層**只給事實**：任務本身，以及最後一筆完成紀錄（完成時刻 + 完成日）。
// `nextDueOn`、「今天該做 vs 即將到期」、徽章數字一律不在這裡算——它們都要問
// 「使用者的今天是哪一天」，而 server 跑在 UTC，答不出來（理由寫在
// shared/utils/maintenance.ts 的檔頭）。
//
// Prisma Client 由呼叫端傳入，與 homeData.ts、waterLog.ts 同一個作法：函式因此能在
// 完全連不到資料庫的情況下測試。缸的歸屬檢查不在這裡——收到 tankId 時已經由
// server/utils/authorization.ts 判斷過了；任務那一半反過來由這裡的
// findOwnedMaintenanceTask 提供給授權層用（與 getCreatureDetail 同型）。

/**
 * 最後一筆完成紀錄用 nested read 取，排序鍵是 `completedOn`，所以吃的是
 * `@@unique([taskId, completedOn])` 建起來的那個索引（issue #122 第 6 節誤植為
 * `@@index([taskId, completedAt])`，那一個目前沒有任何查詢用得到）。
 *
 * **不要**把全部履歷撈回來再取最後一筆：記錄了三年的缸每開一次保養頁就把三年的履歷
 * 讀進記憶體，而畫面上的「上次 07/01」「已完成 08:20」「今天有沒有做」只需要這一筆
 * （完成日只會往前走）。整份履歷是保養歷史頁的事，那一頁還不存在。
 */
const LAST_COMPLETION = { completions: { orderBy: { completedOn: 'desc' }, take: 1 } } as const

type TaskWithCompletions = MaintenanceTask & { completions: MaintenanceCompletion[] }

/** `@db.Date` 與 `DateTime` 一律以 UTC 的日曆日呈現：Prisma 回的 Date 就是那一天的零時 */
function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function toDto(task: TaskWithCompletions): MaintenanceTaskDto {
  const last = task.completions[0]

  return {
    id: task.id,
    name: task.name,
    intervalDays: task.intervalDays,
    startOn: task.startOn ? toDateOnly(task.startOn) : null,
    // schema.prisma 定的最後一層 fallback：尚無完成紀錄且 startOn 為 null 時，
    // 視為建立當天起算。少了它，前端算不出那一種任務的 nextDueOn。
    //
    // 這裡取的是 UTC 的日曆日（createdAt 是時間點，不是日期）：深夜建立的任務對
    // UTC+8 的使用者會早一天。差一天只影響「從未完成過、也沒設 startOn」的第一次
    // 到期日，勾過一次之後就由 completedOn 接手——而那個值本來就是使用者當地的日期。
    createdOn: toDateOnly(task.createdAt),
    displayOrder: task.displayOrder,
    // 從未完成過就是 null，不是假的日期、也不是 0——畫面因此分得出「還沒做過」
    lastCompletion: last
      ? { completedAt: last.completedAt.toISOString(), completedOn: toDateOnly(last.completedOn) }
      : null,
  }
}

/**
 * GET /api/tanks/:id/maintenance 的內容：這個缸啟用中的任務。
 *
 * 排除停用的任務是查詢條件做的（走 `@@index([tankId, isActive, displayOrder])`），
 * 不是撈回來再過濾。它們的完成紀錄仍留在資料庫裡，只是不出現在畫面上。
 *
 * `createdAt` 是次要排序鍵：`displayOrder` 有 `@default(0)`，同一個值的兩個任務由
 * 資料庫決定先後就沒有保證了（與 Tank 的「預設缸」用的是同一個 tiebreaker）。
 */
export async function getMaintenancePage(client: PrismaClient, tankId: string): Promise<MaintenancePageData> {
  const tasks = await client.maintenanceTask.findMany({
    where: { tankId, isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    include: LAST_COMPLETION,
  })

  return { tasks: tasks.map(toDto) }
}

/**
 * 這個任務是不是當前使用者名下、未封存的缸底下、而且還啟用著的那一個。
 *
 * 歸屬透過缸反查（`tank: { userId, archivedAt: null }`，與 getCreatureDetail 同型）——
 * schema.prisma 的 User 註解已定案「不把 userId 反正規化到子表」。
 *
 * 停用的任務在這裡就查不到，於是與「不是你的」「不存在」在授權層收斂成同一個 404：
 * 它本來就不出現在畫面上，能打到它只有舊分頁或手動打 API 兩種可能。
 */
export async function findOwnedMaintenanceTask(
  client: PrismaClient,
  taskId: string,
  userId: string,
): Promise<MaintenanceTaskDto | null> {
  const task = await client.maintenanceTask.findFirst({
    where: { id: taskId, isActive: true, tank: { userId, archivedAt: null } },
    include: LAST_COMPLETION,
  })

  return task ? toDto(task) : null
}

/**
 * 勾選：建立（或沿用）當天那一筆完成紀錄，回傳更新後的任務。
 *
 * `upsert` + `update: {}` 走 `@@unique([taskId, completedOn])`——「連點兩下只會有一筆」
 * 因此是資料庫約束給的保證，不是應用層自己小心的結果。`update` 是空的，重送一次不會
 * 覆蓋原本的 `completedAt`，畫面上的「已完成 08:20」才不會因為第二次請求變成 08:21。
 *
 * `completedAt` 不由呼叫端帶：schema 的 `@default(now())` 就是「按下去的那個瞬間」。
 *
 * 回傳的是重新查過的任務（含這筆完成紀錄），畫面因此不必重抓整頁。null 代表查到之後、
 * 寫入之後歸屬變了（例如缸剛被封存），授權層會回與「查不到」完全相同的 404。
 */
export async function completeTask(
  client: PrismaClient,
  taskId: string,
  completedOn: Date,
  userId: string,
): Promise<MaintenanceTaskDto | null> {
  await client.maintenanceCompletion.upsert({
    where: { taskId_completedOn: { taskId, completedOn } },
    update: {},
    create: { taskId, completedOn },
  })

  return await findOwnedMaintenanceTask(client, taskId, userId)
}

/**
 * 取消勾選：刪掉當天那一筆，回傳更新後的任務。
 *
 * `deleteMany` 而不是 `delete`：沒有東西可刪不是錯誤（`delete` 對不到列會丟 P2025）。
 * 連點兩下的第二次、或在別的裝置上已經取消過，都該安安靜靜地回現況。
 * 條件同時帶 `taskId` 與 `completedOn`，其他日期的完成紀錄因此不受影響。
 */
export async function clearCompletion(
  client: PrismaClient,
  taskId: string,
  completedOn: Date,
  userId: string,
): Promise<MaintenanceTaskDto | null> {
  await client.maintenanceCompletion.deleteMany({ where: { taskId, completedOn } })

  return await findOwnedMaintenanceTask(client, taskId, userId)
}
