import type { PrismaClient } from '@prisma/client'
import type { ValidatedAvatar } from '#shared/utils/avatarUpload'
import type { ImageBlobStore } from './blobStore'
import type { ProfileUser } from './authorization'
import { buildBlobPathname, deleteQuietly as deleteBlobQuietly, vercelImageBlobStore } from './blobStore'

// 自訂頭像的存放（issue #166）。
//
// 這一支負責「把通過檢查的位元組換成 User.customAvatarUrl 上的一個新 URL」，
// 檢查本身在 shared/utils/avatarUpload.ts，授權在 server/utils/authorization.ts。
// store 本身（`@vercel/blob`、pathname 的產生、best-effort 刪除）自 issue #154 起
// 住在 `blobStore.ts`，與生物照片共用。
//
// Prisma Client 與 Blob store 都由呼叫端傳入（與 homeData.ts、guestSandbox.ts 同一個
// 作法）：整段流程因此能在連不到資料庫、也連不到 Blob store 的情況下測試——而這段流程
// 最需要被測的，恰好是三條「有東西壞掉」的路徑（DB 寫入失敗、併發輸家、舊圖刪不掉）。

/** 頭像用的 store 介面。形狀與生物照片完全相同，共用同一個定義。 */
export type AvatarBlobStore = ImageBlobStore

/** 正式的實作。`@vercel/blob` 只出現在 `blobStore.ts` 裡那一次。 */
export const vercelAvatarBlobStore: AvatarBlobStore = vercelImageBlobStore

/** `avatars/{userId}/{random}.{ext}`，由 server 產生，理由見 `buildBlobPathname`。 */
export function buildAvatarPathname(userId: string, extension: string): string {
  return buildBlobPathname('avatars', userId, extension)
}

/** 刪不掉不是這次請求的錯：舊圖留著只是佔空間，把它變成 500 才是把成功的上傳弄丟。 */
async function deleteQuietly(store: AvatarBlobStore, url: string): Promise<void> {
  await deleteBlobQuietly(store, url, 'avatar')
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
