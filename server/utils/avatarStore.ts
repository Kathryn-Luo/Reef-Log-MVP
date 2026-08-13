import type { PrismaClient } from '@prisma/client'
import type { ValidatedAvatar } from '#shared/utils/avatarUpload'
import type { ProfileUser } from './authorization'
import { randomUUID } from 'node:crypto'
import { del, put } from '@vercel/blob'

// 自訂頭像的存放（issue #166）。
//
// 這一支負責「把通過檢查的位元組換成 User.customAvatarUrl 上的一個新 URL」，
// 檢查本身在 shared/utils/avatarUpload.ts，授權在 server/utils/authorization.ts。
//
// Prisma Client 與 Blob store 都由呼叫端傳入（與 homeData.ts、guestSandbox.ts 同一個
// 作法）：整段流程因此能在連不到資料庫、也連不到 Blob store 的情況下測試——而這段流程
// 最需要被測的，恰好是三條「有東西壞掉」的路徑（DB 寫入失敗、併發輸家、舊圖刪不掉）。
//
// ⚠ token 不出現在這個檔案裡。`@vercel/blob` 預設讀部署環境的 `BLOB_READ_WRITE_TOKEN`，
// 而那個值在 Vercel 上依 Production / Preview 兩個 scope 各設一份（由人類維護），
// 於是「production 與 preview 各自打到自己的 store」是環境給的，不是程式碼判斷的。
// 這一點很要緊：preview 的 Neon 分支是從 production 複製來的，可能帶著**一模一樣的**
// `User.id` 與頭像 URL，共用 token 的話 preview 的一次刪除就會打掉正式環境的圖片。
// 也因此它絕不能進 `runtimeConfig.public` 或任何前端 bundle。

/**
 * Blob store 的最小介面——這支模組只需要「放上去」與「刪掉」兩件事。
 *
 * 抽這一層不是為了將來換供應商，而是為了讓上面那三條失敗路徑測得到：
 * 直接呼叫 `put` / `del` 的話，「DB 失敗時剛建立的 Blob 有沒有被刪掉」只能靠
 * 對 `@vercel/blob` 下 module mock 才驗得出來，而那驗到的是 mock 的形狀，不是流程。
 */
export interface AvatarBlobStore {
  put: (pathname: string, data: Uint8Array, contentType: string) => Promise<{ url: string }>
  delete: (url: string) => Promise<void>
}

/** 正式的實作。`@vercel/blob` 只在這裡出現一次。 */
export const vercelAvatarBlobStore: AvatarBlobStore = {
  async put(pathname, data, contentType) {
    // `PutBody` 收 Buffer 而不是 Uint8Array。這是零複製的檢視：multipart 給的本來就是
    // 一個 Buffer，這裡只是把型別接回去，不會再把整張圖抄一份。
    const body = Buffer.from(data.buffer, data.byteOffset, data.byteLength)

    // addRandomSuffix: false —— 隨機的部分已經在 pathname 裡（見 buildAvatarPathname），
    // 兩邊都加只會讓 URL 更長，也讓「這張圖是誰的」在 store 裡更難看出來。
    const { url } = await put(pathname, body, { access: 'public', contentType, addRandomSuffix: false })

    return { url }
  },

  async delete(url) {
    await del(url)
  },
}

/**
 * `avatars/{userId}/{random}.{ext}` —— **由 server 產生**，使用者送來的檔名一個字都不用。
 *
 * 兩件事各自要命：
 *   - 檔名來自使用者的話，`../` 與控制字元就跟著進了 store 的路徑。
 *   - 路徑固定的話（例如 `avatars/{userId}.png`），換頭像會覆寫同一個 URL，
 *     而 Blob 是 immutable + CDN 快取——瀏覽器會繼續顯示舊圖，看起來像「換不掉」。
 *     所以每次上傳都是一個**新的**隨機路徑。
 */
export function buildAvatarPathname(userId: string, extension: string): string {
  return `avatars/${userId}/${randomUUID()}.${extension}`
}

/** 刪不掉不是這次請求的錯：舊圖留著只是佔空間，把它變成 500 才是把成功的上傳弄丟。 */
async function deleteQuietly(store: AvatarBlobStore, url: string): Promise<void> {
  try {
    await store.delete(url)
  }
  catch (cause) {
    // best-effort：這裡刻意不往外拋，也不改變呼叫端的結果。
    // 但也不能完全沒有痕跡——留不下來的 Blob 只有 log 記得，孤兒才查得出來（issue #167）。
    console.warn('[avatar] Blob 刪除失敗，略過（資料庫已是最新狀態）', url, cause)
  }
}

/**
 * 上傳一張新頭像並讓 `User.customAvatarUrl` 指向它，回傳更新後的使用者（含 accounts）。
 * 使用者已不存在時回 `null`——呼叫端把它折成 401。
 *
 * ── 為什麼是 compare-and-set 而不是 `update` ──
 *
 * 兩個上傳同時在飛（連點兩下、兩個分頁）時，`update` 的結果只取決於誰**最後**寫到，
 * 而那與誰的圖比較新無關：先讀到舊值、慢一步才寫入的那個請求會把新的蓋掉，
 * 使用者看到的是自己上一張圖，而剛選的那一張的 Blob 沒人指向、也沒人刪。
 *
 * `updateMany({ where: { id, customAvatarUrl: 讀到的舊值 } })` 讓資料庫自己判斷：
 * `count === 1` 才代表這一份是接在自己讀到的那個狀態之後。輸的那一方不重試、
 * 不覆蓋，只把自己剛上傳的 Blob 收掉——專案內同型的手法見 `guestSandbox.ts` 的
 * `sandboxSeededAt` 冪等鎖。
 */
export async function saveCustomAvatar(
  client: PrismaClient,
  userId: string,
  file: ValidatedAvatar,
  store: AvatarBlobStore,
): Promise<ProfileUser | null> {
  const current = await client.user.findUnique({
    where: { id: userId },
    select: { customAvatarUrl: true },
  })

  // 使用者不在了就連上傳都不必開始——沒有身分可以歸屬的 Blob 一建立就是 orphan
  if (!current) {
    return null
  }

  const previousUrl = current.customAvatarUrl
  const uploaded = await store.put(
    buildAvatarPathname(userId, file.extension),
    file.data,
    file.contentType,
  )

  let claimed: number

  try {
    const claim = await client.user.updateMany({
      where: { id: userId, customAvatarUrl: previousUrl },
      data: { customAvatarUrl: uploaded.url },
    })

    claimed = claim.count
  }
  catch (error) {
    // Blob 已經在 store 裡，而沒有任何一列指向它——把它收掉再讓錯誤照原樣往外走。
    // 刪除是 best-effort：拿刪除的失敗蓋掉原本的資料庫錯誤，等於把真正的原因藏起來。
    await deleteQuietly(store, uploaded.url)
    throw error
  }

  if (claimed === 0) {
    // 併發的輸家：資料庫上是別人更新的狀態，這一張沒有人指向，收掉自己的就好
    await deleteQuietly(store, uploaded.url)
  }
  else if (previousUrl) {
    // 贏了才刪舊的，而且是在資料庫已經改指向新 URL **之後**。
    // 反過來先刪的話，寫入失敗時使用者會連原本那張都沒有了。
    await deleteQuietly(store, previousUrl)
  }

  // 回應一律來自寫入之後重新讀到的那一列：輸家因此回報的是目前真正生效的頭像，
  // 而不是它自己那張已經被刪掉的圖。
  return await client.user.findUnique({
    where: { id: userId },
    include: { accounts: { select: { provider: true } } },
  })
}

/** 一次把「目前這個人長什麼樣」讀齊，回應與判斷用的是同一列（issue #167） */
async function loadProfileUser(client: PrismaClient, userId: string): Promise<ProfileUser | null> {
  return await client.user.findUnique({
    where: { id: userId },
    include: { accounts: { select: { provider: true } } },
  })
}

/**
 * 清掉 `User.customAvatarUrl` 並 best-effort 收掉那個 Blob，回傳更新後的使用者（含 accounts）。
 * 使用者已不存在時回 `null`——呼叫端把它折成 401。
 *
 * ── 三個順序上的決定 ──
 *
 * 1. **要刪哪一個只從 DB 讀。** 呼叫端連一個能傳 URL 的參數都沒有，這是 issue #167 的
 *    第六條驗收條件：接受 client 指定的話，任何人都能拿別人的 Blob URL 來刪別人的圖。
 *
 * 2. **先清 DB，再刪 Blob。** 反過來的話，Blob 刪掉但 DB 清除失敗，使用者會停在一個指向
 *    已不存在檔案的破圖 URL——比「頭像還在」難救得多。刪除失敗只留 log（見 `deleteQuietly`）：
 *    清不掉的檔案只是佔空間，拿它讓整支請求變成 500，等於讓人卡在自己已經按過移除的頭像上。
 *
 * 3. **compare-and-set，不是無條件 `update`。** 與 `saveCustomAvatar` 同一個手法，理由也一樣：
 *    讀到舊值之後、寫入之前若有一次上傳插進來，無條件寫 null 會把剛上傳那一張的 Blob
 *    變成沒有人指向的孤兒（而且照 `previousUrl` 刪掉的還是別人已經處理過的舊圖）。
 *    `count === 0` 的一方什麼都不做，回報目前真正生效的狀態就好。
 */
export async function removeCustomAvatar(
  client: PrismaClient,
  userId: string,
  store: AvatarBlobStore,
): Promise<ProfileUser | null> {
  const current = await loadProfileUser(client, userId)

  if (!current) {
    return null
  }

  const previousUrl = current.customAvatarUrl

  // 本來就沒有自訂頭像：冪等地成功。不寫入、不刪除、也不回 404——
  // 連點兩次「移除」不該有第二次的錯誤（issue #167）。
  if (!previousUrl) {
    return current
  }

  const cleared = await client.user.updateMany({
    where: { id: userId, customAvatarUrl: previousUrl },
    data: { customAvatarUrl: null },
  })

  if (cleared.count === 1) {
    await deleteQuietly(store, previousUrl)
  }

  // 與上傳同一個作法：回應來自寫入之後重新讀到的那一列，而不是上面那份可能已經過期的快照
  return await loadProfileUser(client, userId)
}
