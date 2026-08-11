// 保養提醒（issue #122，畫面是 #15 的 screen-7）在 API 邊界上交換的資料形狀。
//
// 與 shared/types/waterLog.ts 同一個原則：不依賴 @prisma/client 的型別，
// 推算、表單與 unit 測試因此都不必認識 Prisma。
//
// 「下次到期」「今天該做 / 3 天後」「徽章數字」一個都不在這裡——它們全是推算值
// （schema.prisma 的 MaintenanceTask 註解已定案不存欄位），而且都要問一件 server
// 答不出來的事：使用者的「今天」是哪一天。推算住在 shared/utils/maintenance.ts。

/** 某一次「做完了」——畫面上的「已完成 08:20」與「上次 07/01」都取自這裡 */
export interface MaintenanceCompletionDto {
  /** ISO 8601（UTC）。顯示成 08:20 是前端用當地時區格式化的結果 */
  completedAt: string
  /** YYYY-MM-DD，使用者當地的日曆日 */
  completedOn: string
}

export interface MaintenanceTaskDto {
  id: string
  name: string
  intervalDays: number
  /** YYYY-MM-DD。尚無完成紀錄時的起算日；null 則以 createdOn 起算 */
  startOn: string | null
  /** YYYY-MM-DD。task 的建立日，schema 註解定的最後一層 fallback */
  createdOn: string
  displayOrder: number
  isActive: boolean
  /** completedOn 最大的那一筆；從未完成過則為 null */
  lastCompletion: MaintenanceCompletionDto | null
}

/** 新增與編輯保養任務共用的請求內容。 */
export interface MaintenanceTaskInput {
  name: string
  intervalDays: number
  /** YYYY-MM-DD；null 代表從建立當天起算。 */
  startOn: string | null
  isActive: boolean
}

/** 建立任務時額外帶上瀏覽器的當地日曆日，避免從 UTC createdAt 猜錯日期。 */
export interface CreateMaintenanceTaskInput extends MaintenanceTaskInput {
  /** YYYY-MM-DD；只接受 server UTC 日期前後一天。 */
  localCreatedOn: string
}

/**
 * 只回「最後一筆」完成紀錄，不回完整履歷：畫面上的「上次 07/01」「已完成 08:20」
 * 「今天有沒有做」三件事都只需要最後一筆（完成日只會往前走）。
 * 整份履歷是保養歷史頁的事，那一頁還不存在。
 */
export interface MaintenancePageData {
  /** 只含 isActive，依 displayOrder ASC, createdAt ASC */
  tasks: MaintenanceTaskDto[]
}

/** POST / DELETE 的回應：更新後的那一個任務，讓畫面不必重抓整頁 */
export interface MaintenanceTaskResponse {
  task: MaintenanceTaskDto
}

/** POST 的 body。completedAt 刻意不由前端帶——見 shared/utils/maintenance.ts 的說明 */
export interface MaintenanceCompletionRequest {
  /** YYYY-MM-DD，使用者當地的日曆日 */
  completedOn: string
}

/** 畫面上的一列。分區、徽章與「3 天後」都由這些值直接讀得出來 */
export interface MaintenanceRow {
  task: MaintenanceTaskDto
  /** YYYY-MM-DD，推算出來的下次到期日 */
  nextDueOn: string
  /** 使用者當地的今天已經完成過了（畫面上已勾選、降透明度、不計入徽章） */
  completedToday: boolean
  /** nextDueOn 早於今天，而且今天還沒做 */
  overdue: boolean
  /** nextDueOn 距今天幾天：今天是 0、明天是 1、逾期為負。畫面的「3 天後」由它來 */
  dueInDays: number
}
