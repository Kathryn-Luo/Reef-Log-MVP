import type { PrismaClient, User } from '@prisma/client'
import type { CreatureDetailDto, CreatureDetailResponse, CreatureProfileResponse, MoveCreatureResponse, TankCreaturesData } from '#shared/types/creature'
import type { GuestSandboxResponse } from '#shared/types/guestSandbox'
import type { AvatarSource, UserProfileResponse } from '#shared/types/profile'
import type { AvatarUploadPart, AvatarUploadRejection } from '#shared/utils/avatarUpload'
import type { AvatarBlobStore } from './avatarStore'
import type { Timer } from './requestTiming'
import type { TankHomeData, TankOption } from '#shared/types/home'
import type { MaintenancePageData, MaintenanceTaskDto, MaintenanceTaskResponse } from '#shared/types/maintenance'
import type { CreateTankResponse } from '#shared/types/tank'
import type { TrendPageData } from '#shared/types/trend'
import type { CreateWaterLogResponse, WaterLogPageData } from '#shared/types/waterLog'
import { parseAvatarUpload } from '#shared/utils/avatarUpload'
import { parseCreatureStatusInput } from '#shared/utils/creatureDetail'
import { parseCreatureProfileInput } from '#shared/utils/creatureForm'
// completedOn 的規則與保養頁共用同一份（issue #122，與 parseWaterLogInput 同一個作法）
import { parseCompletedOn, parseCompletedOnInput } from '#shared/utils/maintenance'
import { parseCreateMaintenanceTaskInput, parseMaintenanceTaskInput } from '#shared/utils/maintenanceTaskForm'
import { ownsDisplayName, parseDisplayName } from '#shared/utils/profile'
import { parseTankInput } from '#shared/utils/tankForm'
// 時間範圍的規則住在 shared：#123 的畫面用的是同一份四個選項（issue #126）
import { parseTrendRange } from '#shared/utils/trend'
// parseWaterLogInput 與記錄水質的表單共用同一份規則，所以它住在 shared（issue #124）
import { parseWaterLogInput } from '#shared/utils/waterLog'
import { saveCustomAvatar, vercelAvatarBlobStore } from './avatarStore'
import { createCreatureProfile, getCreatureDetail, moveCreature, updateCreatureProfile, updateCreatureStatus } from './creatureDetail'
import { getTankCreatures } from './creatureList'
import { ensureGuestSandbox } from './guestSandbox'
import { createTimer } from './requestTiming'
import { getTankHome, listTankOptions } from './homeData'
import {
  clearCompletion,
  completeTask,
  createMaintenanceTask,
  findOwnedMaintenanceTask,
  getMaintenancePage,
  updateMaintenanceTask,
} from './maintenance'
import { createTank } from './tankWrite'
import { getTrendPage } from './trendData'
import { createWaterLog, getWaterLogPage } from './waterLog'

// 資料歸屬的伺服器邊界（issue #68）。
//
// 每一支涉及使用者資料的 API 都從這裡取得「這次請求可以拿到什麼」。集中在一個檔案
// 有兩個理由：
//   1. 六支 handler 對「未登入」與「不是你的」要給出**同一個**答案。散在各 handler 裡
//      的話，遲早有一支寫成 200 加空清單、或用 400 回答「你是誰」——那正是本 issue 要
//      收掉的既有分歧。
//   2. handler 本身跑不起來（`defineEventHandler`、`createError`、`prisma`、
//      `getCurrentUser` 全是 Nitro 的自動匯入，vitest 裡 import 不進來）。把判斷搬到
//      這一層，「A 的身分打 B 的 id」就變成可以直接呼叫、直接斷言的一次函式呼叫。
//
// ⚠ 這一層是安全邊界，不是 UX。app/middleware/auth.global.ts 與 shared/utils/routeGuard.ts
// （#67）決定的只有「畫面要不要先跳去登入頁」，判斷錯了最多是多跳一次；這裡判斷錯了
// 就是有人讀到別人的資料。兩者都要有，也都不能拿來代替對方。
//
// Prisma Client 由呼叫端傳入（server/utils/prisma.ts 的實例），與 homeData.ts、
// currentContext.ts 同一個作法：函式因此能在完全連不到資料庫的情況下測試。

/**
 * 被拒絕時要丟出去的內容，形狀就是 `createError()` 收的參數。
 *
 * 為什麼回傳描述而不是在這裡 `throw createError()`：`createError` 是 Nitro 的自動匯入，
 * 寫進來的話這整支就跟著 handler 一起變成 import 不進測試的東西。handler 那一行
 * `throw createError(result.error)` 有沒有漏掉，由 authorization-wiring.test.ts 看原始碼守著。
 *
 * 中文一律放 `data.message`：h3 會過濾掉 statusMessage 裡的非 ASCII 字元
 * （見 shared/utils/apiError.ts）。
 */
export interface ApiErrorSpec {
  statusCode: number
  statusMessage: string
  data: { message: string }
}

/** 「可以，這是內容」或「不行，這是要回的錯誤」 */
export type Authorized<T>
  = | { ok: true, value: T }
    | { ok: false, error: ApiErrorSpec }

/** 授權只用得到 id——cookie 裡本來就只有 userId（#64 定案），其餘欄位一概不參與判斷 */
type SessionUser = Pick<User, 'id'>

/**
 * 未登入：沒有 cookie、簽章驗不過、已過期，或 cookie 指向的使用者已不存在。
 *
 * 六支 API 共用同一則答案。訊息刻意是「未登入」而不是舊的「請先建立使用者資料
 * （pnpm db:seed）」——那句話把「這個環境沒 seed 過」講成使用者的問題，而真正的
 * 原因從來都是身分不明。
 *
 * 401 也是 `$api`（app/plugins/api.ts）唯一認得的「該回去登入」訊號：把未登入
 * 折成 404 或 200 空清單的話，人會停在一個看起來只是沒資料的畫面上。
 */
export const NOT_SIGNED_IN: ApiErrorSpec = {
  statusCode: 401,
  statusMessage: 'Not signed in',
  data: { message: '未登入，請先登入後再試一次。' },
}

/**
 * 訪客不能改顯示名稱。
 *
 * `prisma/schema.prisma` 的 `User.displayName` 註解定的是「Google 登入取回傳的 name；
 * **訪客固定為「訪客」**」，`server/utils/guestLogin.ts` 也把它寫成常數
 * `GUEST_DISPLAY_NAME`。少了這道檢查，訪客打一次 PATCH 就能讓資料庫裡出現一個
 * 與已核准的資料模型互相矛盾的值（見 PR #173 的 review）。
 *
 * 為什麼是 403 而不是 404：這裡沒有「別人的資源」可以被列舉——`/api/profile` 永遠
 * 指向呼叫者自己。答案只跟呼叫者自己的 provider 有關，藏起來不會少洩漏任何東西，
 * 反而讓畫面分不出「壞掉了」與「這個帳號本來就不能改」。
 */
export const GUEST_CANNOT_RENAME: ApiErrorSpec = {
  statusCode: 403,
  statusMessage: 'Guest display name is fixed',
  data: { message: '訪客的顯示名稱固定為「訪客」，改用 Google 登入後才能修改。' },
}

/**
 * 訪客不能上傳自訂頭像（Epic #160，2026-08-12 定案）。
 *
 * 兩個理由都不是 UX：
 *   1. **孤兒 Blob。** `prisma/cleanupExpiredGuests.ts` 會刪掉逾期訪客的 `User` 列。
 *      列一刪，`customAvatarUrl` 指的那個 Blob 就再也沒有任何東西記得它——
 *      `DELETE /api/profile/avatar` 只刪「自己 `User` 上的那一個」，永遠輪不到它。
 *      那會是一張永久公開、無人指向的圖片，數量單調遞增。
 *   2. **匿名上傳濫用。** 這是 public repo，訪客登入不需要任何憑證、每次進站自動建帳號。
 *      開放上傳等於任何人都能拿 production 的 Blob store 當免費圖床。
 *
 * 與 `GUEST_CANNOT_RENAME` 同樣選 403 而不是 404，理由見上。
 */
export const GUEST_CANNOT_UPLOAD_AVATAR: ApiErrorSpec = {
  statusCode: 403,
  statusMessage: 'Guests cannot upload an avatar',
  data: { message: '訪客不能上傳頭像，改用 Google 登入後才能設定。' },
}

/**
 * 缸不存在，**或者**存在但不屬於當前使用者——兩者刻意是同一個答案。
 *
 * 分開回答（例如 403 vs 404）等於告訴對方「這個 id 是存在的」，
 * 一支猜 id 的腳本就能把別人的缸列舉出來。
 */
export const TANK_NOT_FOUND: ApiErrorSpec = {
  statusCode: 404,
  statusMessage: 'Tank not found',
  data: { message: '找不到這個缸。' },
}

/** 生物版本的同一個決定：不存在與不屬於你回同一句話 */
export const CREATURE_NOT_FOUND: ApiErrorSpec = {
  statusCode: 404,
  statusMessage: 'Creature not found',
  data: { message: '找不到這隻生物。' },
}

/**
 * 網址少了 id 那一段。實務上走不到——路由沒有那一段就不會匹配到這支 handler——
 * 但既有行為就是 400，本 issue 不順手改掉它，只把它排到身分檢查**之後**：
 * 未登入的人不該先收到一份「你的網址寫錯了」的檢查報告。
 */
export const MISSING_TANK_ID: ApiErrorSpec = {
  statusCode: 400,
  statusMessage: 'Missing tank id',
  data: { message: '網址少了缸的 id。' },
}

/**
 * 保養任務版本的同一個決定，外加一種本 issue 特有的情況：**已停用的任務也回這一句**。
 *
 * 停用的任務本來就不出現在畫面上，能打到它只有舊分頁或手動打 API 兩種可能，
 * 兩種都不需要一份更詳細的說明——而分開回答同樣會洩漏「這個 id 是存在的」。
 */
export const MAINTENANCE_TASK_NOT_FOUND: ApiErrorSpec = {
  statusCode: 404,
  statusMessage: 'Maintenance task not found',
  data: { message: '找不到這個保養任務。' },
}

/** 同上，生物版本 */
export const MISSING_CREATURE_ID: ApiErrorSpec = {
  statusCode: 400,
  statusMessage: 'Missing creature id',
  data: { message: '網址少了生物的 id。' },
}

/** 同上，保養任務版本 */
export const MISSING_TASK_ID: ApiErrorSpec = {
  statusCode: 400,
  statusMessage: 'Missing maintenance task id',
  data: { message: '網址少了保養任務的 id。' },
}

/** 表單／請求內容不合法。訊息由 shared/ 的 parse 函式給，兩邊（頁面與 API）同一份規則 */
function invalidInput(statusMessage: string, message: string): ApiErrorSpec {
  return { statusCode: 400, statusMessage, data: { message } }
}

function parseMoveCreatureInput(raw: unknown): { ok: true, tankId: string } | { ok: false, error: ApiErrorSpec } {
  const source = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  const tankId = typeof source.tankId === 'string' ? source.tankId.trim() : ''

  return tankId
    ? { ok: true, tankId }
    : { ok: false, error: invalidInput('Invalid creature move input', '請選擇要移動到的缸。') }
}

/** PostgreSQL serializable transaction 的 write conflict / deadlock；這是 Prisma 的可重試錯誤碼。 */
function isTransactionConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034'
}

/** 初次執行加兩次重試，避免碰撞時無限佔用 Vercel function。 */
const MOVE_TRANSACTION_ATTEMPTS = 3

/**
 * 兩支寫入 API 的 request body，**刻意延後到通過檢查之後才取得**。
 *
 * 取 body 這件事本身就會拒絕請求：h3 的 `readBody` 對畸形 JSON 直接 throw 400
 * `Invalid JSON body`。所以只要 handler 寫成 `await readBody(event)` 的參數，
 * 它就跑在這裡的身分判斷**之前**，完全沒登入的人送一段壞掉的 JSON 會拿到 400——
 * 而 issue #68 要的是「未登入的任何一支 API 一律 401」。狀態碼是這道邊界對外唯一的
 * 說法，不能被一個前置的格式檢查蓋掉。
 *
 * 收成函式還恢復了 PATCH 在 #68 之前的行為：擋下來的請求連 body 都不會讀進記憶體。
 */
type BodyReader = () => Promise<unknown>

/**
 * 這個缸是不是當前使用者名下、未封存的那一個。
 *
 * 條件與 listTankOptions 完全一致（`userId` + `archivedAt: null`），因為缸切換選單
 * 就是由那一份清單產生的：清單裡沒有的缸，從網址繞進來也不該拿得到。已封存的缸
 * 一併排除——它不出現在任何清單裡，就不該有一條旁門進得去。
 *
 * 只取 id：這是一次「是不是你的」的問答，缸的內容要不要讀是下一步的事。
 */
async function ownsTank(client: Pick<PrismaClient, 'tank'>, userId: string, tankId: string): Promise<boolean> {
  const tank = await client.tank.findFirst({
    where: { id: tankId, userId, archivedAt: null },
    select: { id: true },
  })

  return tank !== null
}

/** 缸的三道關卡：先問你是誰，再問網址完不完整，最後才問這個缸是不是你的 */
async function requireOwnedTank(
  client: PrismaClient,
  user: SessionUser | null,
  tankId: string | undefined,
): Promise<Authorized<string>> {
  if (!user) {
    // 這一條在任何查詢之前：未登入的判定不必、也不該讓資料庫多做一次工（#64 第 2 節）
    return { ok: false, error: NOT_SIGNED_IN }
  }

  if (!tankId) {
    return { ok: false, error: MISSING_TANK_ID }
  }

  return await ownsTank(client, user.id, tankId)
    ? { ok: true, value: tankId }
    : { ok: false, error: TANK_NOT_FOUND }
}

/**
 * 生物的同三道關卡。歸屬透過缸反查（`tank: { userId, archivedAt: null }`，見
 * getCreatureDetail）——schema.prisma 的 User 註解已定案「不把 userId 反正規化到子表」。
 *
 * 回傳的是查到的那一隻，不是一個布林值：呼叫端接著就要用它
 * （詳情頁直接送出，PATCH 要用它真實的 addedOn），沒有理由再查第二次。
 */
async function requireOwnedCreature(
  client: PrismaClient,
  user: SessionUser | null,
  creatureId: string | undefined,
): Promise<Authorized<CreatureDetailDto>> {
  if (!user) {
    return { ok: false, error: NOT_SIGNED_IN }
  }

  if (!creatureId) {
    return { ok: false, error: MISSING_CREATURE_ID }
  }

  const creature = await getCreatureDetail(client, creatureId, user.id)

  return creature
    ? { ok: true, value: creature }
    : { ok: false, error: CREATURE_NOT_FOUND }
}

/**
 * 保養任務的同三道關卡。歸屬一樣透過缸反查，另外多一條「還啟用著」
 * （見 findOwnedMaintenanceTask），三種查不到的情況因此收斂成同一個 404。
 *
 * 回傳的是查到的那一個任務，不是布林值：POST / DELETE 被擋下來時要的就是這個判斷，
 * 通過時則接著寫入，沒有理由再查第二次。
 */
async function requireOwnedMaintenanceTask(
  client: PrismaClient,
  user: SessionUser | null,
  taskId: string | undefined,
): Promise<Authorized<MaintenanceTaskDto>> {
  if (!user) {
    return { ok: false, error: NOT_SIGNED_IN }
  }

  if (!taskId) {
    return { ok: false, error: MISSING_TASK_ID }
  }

  const task = await findOwnedMaintenanceTask(client, taskId, user.id)

  return task
    ? { ok: true, value: task }
    : { ok: false, error: MAINTENANCE_TASK_NOT_FOUND }
}

/**
 * GET /api/tanks —— 缸切換選單。
 *
 * 未登入回 401，不是 200 加一個空清單。空清單與「這個帳號還沒有缸」在前端無法區分，
 * 首頁會安安靜靜地畫出「建立第一個缸」的空狀態，而人其實只是 session 過期了。
 */
export async function resolveTankOptions(
  client: PrismaClient,
  user: SessionUser | null,
): Promise<Authorized<{ tanks: TankOption[] }>> {
  if (!user) {
    return { ok: false, error: NOT_SIGNED_IN }
  }

  return { ok: true, value: { tanks: await listTankOptions(client, user.id) } }
}

/**
 * POST /api/guest-sandbox —— 補上這位使用者欠著的示範資料（issue #144）。
 *
 * 由首頁在拿到一份空的缸清單之後呼叫：那正是「沙盒還沒複製完」與「這個帳號真的沒有缸」
 * 唯一分不開的時刻，而這支 API 的回答把兩者分開。已經備妥的話它什麼都不做
 * （見 ensureGuestSandbox 的冪等鎖），所以重新整理、兩個分頁、連點兩下都安全。
 *
 * 未登入回 401，與其他每一支一樣。這支會寫入，所以更不能折成 200——
 * 沒有身分就沒有「你的沙盒」可言。
 *
 * 這裡不再問一次「你是不是訪客」：Google 使用者建立當下 sandboxSeededAt 就有值
 * （見 googleLogin.ts），claim 一律搶不到。判斷只留在那一個欄位上，不散成兩處。
 */
export async function resolveGuestSandbox(
  client: PrismaClient,
  user: SessionUser | null,
  timer: Timer = createTimer(),
): Promise<Authorized<GuestSandboxResponse>> {
  if (!user) {
    return { ok: false, error: NOT_SIGNED_IN }
  }

  return { ok: true, value: await ensureGuestSandbox(client, user.id, timer) }
}

/**
 * GET /api/profile —— 取得當前登入使用者的公開個人資料。
 *
 * 未登入回 401。
 */
export async function resolveProfile(
  client: PrismaClient,
  user: SessionUser | null,
): Promise<Authorized<UserProfileResponse>> {
  if (!user) {
    return { ok: false, error: NOT_SIGNED_IN }
  }

  const fullUser = await client.user.findUnique({
    where: { id: user.id },
    include: {
      accounts: {
        select: {
          provider: true,
        },
      },
    },
  })

  if (!fullUser) {
    return { ok: false, error: NOT_SIGNED_IN }
  }

  return { ok: true, value: toUserProfileResponse(fullUser) }
}

/** `toUserProfileResponse` 需要的那幾欄。`saveCustomAvatar` 回的也是這個形狀。 */
export type ProfileUser = Pick<User, 'displayName' | 'email' | 'createdAt' | 'customAvatarUrl' | 'googleAvatarUrl'> & {
  accounts: { provider: string }[]
}

function toUserProfileResponse(user: ProfileUser): UserProfileResponse {
  const avatarUrl = user.customAvatarUrl ?? user.googleAvatarUrl ?? null
  const avatarSource: AvatarSource = user.customAvatarUrl
    ? 'custom'
    : user.googleAvatarUrl
      ? 'google'
      : 'none'

  return {
    displayName: user.displayName,
    email: user.email,
    providers: user.accounts.map(account => account.provider),
    createdAt: user.createdAt.toISOString(),
    avatarUrl,
    avatarSource,
  }
}

/**
 * 「這位是不是純訪客」——兩支寫入 API 共用的同一道閘門。
 *
 * 訪客不能改名（#171）、也不能上傳頭像（#166），理由不同但判斷完全一樣：
 * **有沒有任何一個非 `GUEST` 的 provider**。判斷本身住在
 * `shared/utils/profile.ts` 的 `ownsDisplayName`，前端藏起入口用的是同一支——
 * 三處共用一份，才不會有人日後只改了其中一處。
 *
 * 不用「第一個 provider 是不是 GUEST」，也不用「名字等不等於『訪客』」：
 * 訪客沙盒日後若接上 Google，帳號會同時掛著兩個 `Account`，那時兩件事都該放行。
 *
 * 這道檢查刻意排在讀取 request body / multipart **之前**（見兩個呼叫端），
 * 所以被擋下來的請求連內容都不會進到記憶體。
 */
async function requireNonGuest(
  client: PrismaClient,
  userId: string,
  guestError: ApiErrorSpec,
): Promise<Authorized<ProfileUser>> {
  const current = await client.user.findUnique({
    where: { id: userId },
    include: { accounts: { select: { provider: true } } },
  })

  // cookie 有效但使用者已被刪除（訪客沙盒過期）——與其他幾支同一個答案
  if (!current) {
    return { ok: false, error: NOT_SIGNED_IN }
  }

  if (!ownsDisplayName(current.accounts.map(account => account.provider))) {
    return { ok: false, error: guestError }
  }

  return { ok: true, value: current }
}

/** PATCH /api/profile —— 修改當前登入使用者的顯示名稱。 */
export async function updateOwnedProfile(
  client: PrismaClient,
  user: SessionUser | null,
  readBody: BodyReader,
): Promise<Authorized<UserProfileResponse>> {
  if (!user) {
    return { ok: false, error: NOT_SIGNED_IN }
  }

  // 先確認「這個帳號可不可以改名」，再談「這次送來的名字合不合格」。順序刻意如此：
  // 訪客不管送什麼都是 403，不會拿到一份「你的名字太長了」的檢查報告，讓人以為
  // 改短一點就能過。body 也因此完全不必讀。
  const allowed = await requireNonGuest(client, user.id, GUEST_CANNOT_RENAME)

  if (!allowed.ok) {
    return allowed
  }

  const parsed = parseDisplayName(await readBody())

  if (!parsed.ok) {
    return { ok: false, error: invalidInput('Invalid display name', parsed.message) }
  }

  const updatedUser = await client.user.update({
    where: { id: user.id },
    data: { displayName: parsed.value },
    include: { accounts: { select: { provider: true } } },
  })

  return { ok: true, value: toUserProfileResponse(updatedUser) }
}

/**
 * 拒絕上傳的三種理由各自對應一個 statusMessage。
 *
 * 三種都是 400，但**不能是同一句話**：UI 要靠它們分辨顯示「檔案太大」還是
 * 「格式不支援」（#168）。中文訊息一律在 `data.message`（h3 會過濾掉 statusMessage
 * 裡的非 ASCII 字元，見 shared/utils/apiError.ts）。
 */
const AVATAR_REJECTION_STATUS: Record<AvatarUploadRejection, string> = {
  'missing': 'Missing avatar file',
  'too-large': 'Avatar file too large',
  'unsupported-format': 'Unsupported avatar format',
}

/** multipart 的內容，與 body 一樣**刻意延後**到通過身分檢查之後才取得（見下方註解） */
type MultipartReader = () => Promise<AvatarUploadPart[] | undefined>

/**
 * POST /api/profile/avatar —— 上傳一張自訂頭像（issue #166）。
 *
 * 順序是「先驗證登入，再讀取與驗證檔案」，而且這裡的順序比其他幾支更要緊：
 * 未登入的人不該有辦法讓 server 先把一份 2 MB 的檔案收進記憶體，才被告知他根本沒有
 * 身分。`readParts` 因此是一個 thunk，不是已經 await 好的值。
 *
 * 檔案本身的三道檢查（MIME、副檔名、magic bytes）與 2 MB 上限在
 * `shared/utils/avatarUpload.ts`；上傳、compare-and-set 與 Blob 收拾在
 * `server/utils/avatarStore.ts`。
 *
 * **訪客不能上傳**（Epic #160，2026-08-12 定案，見 GUEST_CANNOT_UPLOAD_AVATAR）。那道
 * 檢查排在 `readParts()` 之前：未登入與訪客都不該有辦法讓 server 先把一份 2 MB 的檔案
 * 收進記憶體，才被告知他不能傳。
 *
 * `store` 是預設參數而不是模組內直接呼叫，理由與 `resolveGuestSandbox` 的 `timer`
 * 相同：測試餵得進替身，正式路徑一個字都不必改。
 */
export async function updateOwnedAvatar(
  client: PrismaClient,
  user: SessionUser | null,
  readParts: MultipartReader,
  store: AvatarBlobStore = vercelAvatarBlobStore,
): Promise<Authorized<UserProfileResponse>> {
  if (!user) {
    return { ok: false, error: NOT_SIGNED_IN }
  }

  // 401 → 403 → 400。訪客不管送什麼檔案都是 403，multipart 因此完全不必讀——
  // 這是這道檢查最實際的好處：匿名腳本連 2 MB 都送不進 server 的記憶體。
  const allowed = await requireNonGuest(client, user.id, GUEST_CANNOT_UPLOAD_AVATAR)

  if (!allowed.ok) {
    return allowed
  }

  const parsed = parseAvatarUpload(await readParts())

  if (!parsed.ok) {
    return { ok: false, error: invalidInput(AVATAR_REJECTION_STATUS[parsed.reason], parsed.message) }
  }

  const owner = await saveCustomAvatar(client, user.id, parsed.value, store)

  // 上面查到人之後才走到這裡，所以 null 只可能是「這一瞬間被刪掉了」——同一個答案
  if (!owner) {
    return { ok: false, error: NOT_SIGNED_IN }
  }

  return { ok: true, value: toUserProfileResponse(owner) }
}

/** GET /api/tanks/:id/home —— screen-1 單一缸的內容 */
export async function resolveTankHome(
  client: PrismaClient,
  user: SessionUser | null,
  tankId: string | undefined,
): Promise<Authorized<TankHomeData>> {
  const owned = await requireOwnedTank(client, user, tankId)

  if (!owned.ok) {
    return owned
  }

  return { ok: true, value: await getTankHome(client, owned.value) }
}

/** GET /api/tanks/:id/water-logs —— screen-3 水質記錄的歷史與前次讀值 */
export async function resolveWaterLogPage(
  client: PrismaClient,
  user: SessionUser | null,
  tankId: string | undefined,
): Promise<Authorized<WaterLogPageData>> {
  const owned = await requireOwnedTank(client, user, tankId)

  if (!owned.ok) {
    return owned
  }

  return { ok: true, value: await getWaterLogPage(client, owned.value) }
}

/**
 * GET /api/tanks/:id/trends —— screen-4 六個測項的序列、統計與正常區間。
 *
 * `range` 以未解析的原始值傳進來（`getQuery(event).range`），解析在這裡、而且排在
 * 身分與歸屬**之後**：先解析的話，未登入的人送一個 `?range=year` 會拿到 400，而
 * #68 要的是「未登入的任何一支 API 一律 401」；打別人缸的人也會從 400 得知
 * 「這個缸是存在的，只是你參數寫錯了」。順序與 createOwnedWaterLog 的 body 一致
 * ——身分先於歸屬，歸屬先於內容。
 *
 * `now` 由呼叫端傳入，正式的 handler 走預設值（與 parseWaterLogInput 同一個作法）。
 */
export async function resolveTrendPage(
  client: PrismaClient,
  user: SessionUser | null,
  tankId: string | undefined,
  range: unknown,
  now: Date = new Date(),
): Promise<Authorized<TrendPageData>> {
  const owned = await requireOwnedTank(client, user, tankId)

  if (!owned.ok) {
    return owned
  }

  const parsed = parseTrendRange(range)

  if (!parsed.ok) {
    return { ok: false, error: invalidInput('Invalid trend range', parsed.message) }
  }

  return { ok: true, value: await getTrendPage(client, owned.value, parsed.value, now) }
}

/**
 * POST /api/tanks/:id/water-logs —— screen-3 儲存一筆量測。
 *
 * 這是第一支會**寫入缸內容**的 API，所以順序特別要緊：歸屬先於內容。
 * `readBody` 是個函式而不是值，被擋下來的請求因此連 body 都不會讀——
 * 打別人缸的人拿到的是 404，不是一份「你的表單哪裡填錯了」的檢查報告
 * （與 createOwnedTank 同一個作法，authorization-wiring.test.ts 看原始碼守著）。
 */
export async function createOwnedWaterLog(
  client: PrismaClient,
  user: SessionUser | null,
  tankId: string | undefined,
  readBody: BodyReader,
): Promise<Authorized<CreateWaterLogResponse>> {
  const owned = await requireOwnedTank(client, user, tankId)

  if (!owned.ok) {
    return owned
  }

  const parsed = parseWaterLogInput(await readBody())

  if (!parsed.ok) {
    return { ok: false, error: invalidInput('Invalid water log input', parsed.message) }
  }

  return { ok: true, value: { waterLog: await createWaterLog(client, owned.value, parsed.value) } }
}

/** GET /api/tanks/:id/maintenance —— screen-7 這個缸啟用中的保養任務與各自的最後一筆完成紀錄 */
export async function resolveMaintenancePage(
  client: PrismaClient,
  user: SessionUser | null,
  tankId: string | undefined,
): Promise<Authorized<MaintenancePageData>> {
  const owned = await requireOwnedTank(client, user, tankId)

  if (!owned.ok) {
    return owned
  }

  return { ok: true, value: await getMaintenancePage(client, owned.value) }
}

/** GET /api/maintenance-tasks/:id —— 編輯頁直接載入目前任務。 */
export async function resolveMaintenanceTask(
  client: PrismaClient,
  user: SessionUser | null,
  taskId: string | undefined,
): Promise<Authorized<MaintenanceTaskResponse>> {
  const owned = await requireOwnedMaintenanceTask(client, user, taskId)

  return owned.ok
    ? { ok: true, value: { task: owned.value } }
    : owned
}

/** POST /api/tanks/:id/maintenance-tasks —— 在目前缸建立一個任務。 */
export async function createOwnedMaintenanceTask(
  client: PrismaClient,
  user: SessionUser | null,
  tankId: string | undefined,
  readBody: BodyReader,
  now: Date = new Date(),
): Promise<Authorized<MaintenanceTaskResponse>> {
  const owned = await requireOwnedTank(client, user, tankId)

  if (!owned.ok) {
    return owned
  }

  const parsed = parseCreateMaintenanceTaskInput(await readBody(), now)

  if (!parsed.ok) {
    return { ok: false, error: invalidInput('Invalid maintenance task input', parsed.message) }
  }

  return { ok: true, value: { task: await createMaintenanceTask(client, owned.value, parsed.value) } }
}

/** PATCH /api/maintenance-tasks/:id —— 編輯週期、起算日或停用任務。 */
export async function updateOwnedMaintenanceTask(
  client: PrismaClient,
  user: SessionUser | null,
  taskId: string | undefined,
  readBody: BodyReader,
): Promise<Authorized<MaintenanceTaskResponse>> {
  if (!user) {
    return { ok: false, error: NOT_SIGNED_IN }
  }

  const owned = await requireOwnedMaintenanceTask(client, user, taskId)

  if (!owned.ok) {
    return owned
  }

  const parsed = parseMaintenanceTaskInput(await readBody(), {
    fallbackStartOn: owned.value.createdOn,
    lastCompletedOn: owned.value.lastCompletion?.completedOn,
  })

  if (!parsed.ok) {
    return { ok: false, error: invalidInput('Invalid maintenance task input', parsed.message) }
  }

  const task = await updateMaintenanceTask(client, owned.value.id, user.id, parsed.value)

  return task
    ? { ok: true, value: { task } }
    : { ok: false, error: MAINTENANCE_TASK_NOT_FOUND }
}

/**
 * POST /api/maintenance-tasks/:id/completions —— screen-7 勾選今天的保養。
 *
 * 寫入掛在任務底下（與 /api/creatures/:id/... 一致），缸的歸屬由 task → tank 反查。
 * 順序與其他兩支寫入 API 相同：身分 → 歸屬 → 內容，`readBody` 是個函式而不是值，
 * 被擋下來的請求因此連 body 都不會讀。
 *
 * `now` 由呼叫端傳入，預設走真實時鐘：completedOn 的容忍度因此測得到邊界值，
 * 測試也不必動系統時鐘（與 parseWaterLogInput 同一個作法）。
 */
export async function resolveCompleteTask(
  client: PrismaClient,
  user: SessionUser | null,
  taskId: string | undefined,
  readBody: BodyReader,
  now: Date = new Date(),
): Promise<Authorized<MaintenanceTaskResponse>> {
  // 這一條與 requireOwnedMaintenanceTask 裡的那條重複，但它讓下面用得到 user.id
  // ——寫入之後的重新查詢自己也要帶歸屬條件，不能只依賴「呼叫之前已經檢查過了」
  // （與 applyCreatureStatus 同一個作法）
  if (!user) {
    return { ok: false, error: NOT_SIGNED_IN }
  }

  const owned = await requireOwnedMaintenanceTask(client, user, taskId)

  if (!owned.ok) {
    return owned
  }

  const parsed = parseCompletedOnInput(await readBody(), now)

  if (!parsed.ok) {
    return { ok: false, error: invalidInput('Invalid completion input', parsed.message) }
  }

  const task = await completeTask(client, owned.value.id, parsed.value, user.id)

  // null＝查到之後、寫入之後歸屬變了（例如缸剛被封存）。回與「查不到」完全相同的 404，
  // 與 applyCreatureStatus 同一個決定：那正是此刻為真的事。
  return task
    ? { ok: true, value: { task } }
    : { ok: false, error: MAINTENANCE_TASK_NOT_FOUND }
}

/**
 * DELETE /api/maintenance-tasks/:id/completions/:completedOn —— 取消今天的勾選。
 *
 * completedOn 從網址那一段來，規則與 POST 的 body 同一份（parseCompletedOn）——
 * 否則同一個日期會出現「POST 收得下、DELETE 卻刪不掉」這種歪掉的組合。
 *
 * 沒有東西可刪不是錯誤：連點兩下的第二次、或在別的裝置上已經取消過，都回現況。
 */
export async function resolveClearCompletion(
  client: PrismaClient,
  user: SessionUser | null,
  taskId: string | undefined,
  completedOn: string | undefined,
  now: Date = new Date(),
): Promise<Authorized<MaintenanceTaskResponse>> {
  // 與上面同一個理由：重新查詢那一步要用得到 user.id
  if (!user) {
    return { ok: false, error: NOT_SIGNED_IN }
  }

  const owned = await requireOwnedMaintenanceTask(client, user, taskId)

  if (!owned.ok) {
    return owned
  }

  const parsed = parseCompletedOn(completedOn, now)

  if (!parsed.ok) {
    return { ok: false, error: invalidInput('Invalid completion date', parsed.message) }
  }

  const task = await clearCompletion(client, owned.value.id, parsed.value, user.id)

  return task
    ? { ok: true, value: { task } }
    : { ok: false, error: MAINTENANCE_TASK_NOT_FOUND }
}

/** GET /api/tanks/:id/creatures —— screen-5 生物庫存 */
export async function resolveTankCreatures(
  client: PrismaClient,
  user: SessionUser | null,
  tankId: string | undefined,
): Promise<Authorized<TankCreaturesData>> {
  const owned = await requireOwnedTank(client, user, tankId)

  if (!owned.ok) {
    return owned
  }

  return { ok: true, value: { creatures: await getTankCreatures(client, owned.value) } }
}

/** POST /api/tanks/:id/creatures —— 在目前使用者的缸建立一隻生物。 */
export async function createOwnedCreature(
  client: PrismaClient,
  user: SessionUser | null,
  tankId: string | undefined,
  readBody: BodyReader,
  now: Date = new Date(),
): Promise<Authorized<CreatureProfileResponse>> {
  const owned = await requireOwnedTank(client, user, tankId)

  if (!owned.ok) {
    return owned
  }

  const parsed = parseCreatureProfileInput(await readBody(), now)

  if (!parsed.ok) {
    return { ok: false, error: invalidInput('Invalid creature profile input', parsed.message) }
  }

  return { ok: true, value: { creature: await createCreatureProfile(client, owned.value, parsed.value) } }
}

/** GET /api/creatures/:id —— screen-6 生物詳情 */
export async function resolveCreatureDetail(
  client: PrismaClient,
  user: SessionUser | null,
  creatureId: string | undefined,
): Promise<Authorized<CreatureDetailResponse>> {
  const owned = await requireOwnedCreature(client, user, creatureId)

  if (!owned.ok) {
    return owned
  }

  return { ok: true, value: { creature: owned.value } }
}

/**
 * PATCH /api/creatures/:id —— 更新狀態與死亡 / 生病記錄。
 *
 * 本 issue 唯一一條「擋不住就會**改到**別人資料」的路徑，其餘五支最壞只是讀到。
 * 所以歸屬檢查放在解析與寫入之前：被擋下來時 `creature.update` 一次都不會被呼叫。
 *
 * 入缸日仍然不由請求提供，取的是上一步查回來那一隻實際的 `addedOn`——
 * 由 body 帶進來的話，送一個假的入缸日就能繞過「死亡日不能早於入缸日」。
 */
export async function applyCreatureStatus(
  client: PrismaClient,
  user: SessionUser | null,
  creatureId: string | undefined,
  readBody: BodyReader,
): Promise<Authorized<CreatureDetailResponse>> {
  // 身分先於一切。這一條與 requireOwnedCreature 裡的那條重複，但它讓下面用得到 user.id
  // ——寫入語句自己也要帶歸屬條件，不能只依賴「呼叫之前已經檢查過了」。
  if (!user) {
    return { ok: false, error: NOT_SIGNED_IN }
  }

  const owned = await requireOwnedCreature(client, user, creatureId)

  if (!owned.ok) {
    return owned
  }

  const parsed = parseCreatureStatusInput(await readBody(), { addedOn: owned.value.addedOn })

  if (!parsed.ok) {
    return { ok: false, error: invalidInput('Invalid creature status input', parsed.message) }
  }

  const creature = await updateCreatureStatus(client, owned.value.id, user.id, parsed.value)

  // null＝查到之後、寫入之前歸屬變了。回與「查不到」完全相同的 404：
  // 那正是此刻為真的事，而且與其他路徑一個字都不差（見 CREATURE_NOT_FOUND）。
  return creature
    ? { ok: true, value: { creature } }
    : { ok: false, error: CREATURE_NOT_FOUND }
}

/** PATCH /api/creatures/:id/profile —— 編輯俗名、分類、入缸日與價格等基本資料。 */
export async function updateOwnedCreatureProfile(
  client: PrismaClient,
  user: SessionUser | null,
  creatureId: string | undefined,
  readBody: BodyReader,
  now: Date = new Date(),
): Promise<Authorized<CreatureProfileResponse>> {
  if (!user) {
    return { ok: false, error: NOT_SIGNED_IN }
  }

  const owned = await requireOwnedCreature(client, user, creatureId)

  if (!owned.ok) {
    return owned
  }

  const parsed = parseCreatureProfileInput(await readBody(), now, {
    observedSickOn: owned.value.observedSickOn,
    diedOn: owned.value.diedOn,
  })

  if (!parsed.ok) {
    return { ok: false, error: invalidInput('Invalid creature profile input', parsed.message) }
  }

  const creature = await updateCreatureProfile(client, owned.value.id, user.id, parsed.value)

  return creature
    ? { ok: true, value: { creature } }
    : { ok: false, error: CREATURE_NOT_FOUND }
}

/**
 * PATCH /api/creatures/:id/move —— 將生物移到同一使用者名下的另一個未封存缸。
 *
 * 來源與目標都先以目前 session 的 userId 驗證；目標不存在、屬於他人或已封存一律回同一個
 * 404。真正寫入時仍將來源歸屬放在 where，防止來源在兩次查詢之間被移走。
 */
export async function moveOwnedCreature(
  client: PrismaClient,
  user: SessionUser | null,
  creatureId: string | undefined,
  readBody: BodyReader,
): Promise<Authorized<MoveCreatureResponse>> {
  if (!user) {
    return { ok: false, error: NOT_SIGNED_IN }
  }

  if (!creatureId) {
    return { ok: false, error: MISSING_CREATURE_ID }
  }

  const source = await client.creature.findFirst({
    where: { id: creatureId, tank: { userId: user.id, archivedAt: null } },
    select: { id: true, tankId: true },
  })

  if (!source) {
    return { ok: false, error: CREATURE_NOT_FOUND }
  }

  const parsed = parseMoveCreatureInput(await readBody())

  if (!parsed.ok) {
    return parsed
  }

  if (source.tankId === parsed.tankId) {
    return { ok: false, error: invalidInput('Same source and target tank', '來源與目標不能是同一個缸。') }
  }

  // 目標歸屬檢查與來源寫入必須在同一個 serializable transaction：目標缸在檢查之後
  // 被封存或改變歸屬時，交易不會默默把生物移到當下不合格的目標。
  for (let attempt = 0; attempt < MOVE_TRANSACTION_ATTEMPTS; attempt++) {
    try {
      const outcome = await client.$transaction(async (transaction) => {
        if (!await ownsTank(transaction, user.id, parsed.tankId)) {
          return 'target-not-found' as const
        }

        return await moveCreature(transaction, source.id, user.id, parsed.tankId)
          ? 'moved' as const
          : 'source-not-found' as const
      }, { isolationLevel: 'Serializable' })

      if (outcome === 'target-not-found') {
        return { ok: false, error: TANK_NOT_FOUND }
      }

      return outcome === 'moved'
        ? { ok: true, value: { creatureId: source.id, tankId: parsed.tankId } }
        : { ok: false, error: CREATURE_NOT_FOUND }
    }
    catch (error) {
      if (!isTransactionConflict(error) || attempt === MOVE_TRANSACTION_ATTEMPTS - 1) {
        throw error
      }
    }
  }

  throw new Error('Move transaction retry loop exhausted')
}

/**
 * POST /api/tanks —— 建立缸。
 *
 * 歸屬取自 session 裡那一位，不是資料表中最早建立的那一位（認證導入前的暫時實作，
 * 已於 #64 移除）。身分檢查排在欄位檢查之前：未登入的人拿到的答案該是 401，
 * 而不是一份「缸名不能空白」的表單檢查報告——那等於告訴他這支 API 願意跟他對話。
 */
export async function createOwnedTank(
  client: PrismaClient,
  user: SessionUser | null,
  readBody: BodyReader,
): Promise<Authorized<CreateTankResponse>> {
  if (!user) {
    return { ok: false, error: NOT_SIGNED_IN }
  }

  const parsed = parseTankInput(await readBody())

  if (!parsed.ok) {
    return { ok: false, error: invalidInput('Invalid tank input', parsed.message) }
  }

  return { ok: true, value: { tank: await createTank(client, user.id, parsed.value) } }
}
