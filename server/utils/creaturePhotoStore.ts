import type { PrismaClient } from '@prisma/client'
import type { CreatureDetailDto } from '#shared/types/creature'
import type { ValidatedImage } from '#shared/utils/imageUpload'
import type { ImageBlobStore } from './blobStore'
import { buildBlobPathname, deleteQuietly as deleteBlobQuietly } from './blobStore'
import { getCreatureDetail } from './creatureDetail'

// 生物照片的存放（issue #154）。
//
// 這一支負責「把通過檢查的位元組換成 Creature.photoUrl 上的一個新 URL」，
// 檢查本身在 shared/utils/creaturePhotoUpload.ts，授權在 server/utils/authorization.ts，
// store 本身在 blobStore.ts。整體與頭像（avatarStore.ts）是同一套手法，差別有兩個：
//
//   1. **歸屬不在自己身上。** 頭像掛在 `User.id` 上，「是不是你的」等於「是不是你」；
//      生物掛在缸底下，缸才掛在使用者底下。所以每一句寫入的 where 都帶著
//      `tank: { userId, archivedAt: null }`——與 creatureDetail.ts 其餘寫入完全一致。
//      呼叫端在這之前已經查過一次，這裡不是重複檢查，而是**讓歸屬在寫入語句本身成立**：
//      查完到寫入之間有一段空隙，而「移動到其他缸」是既有功能（#120）。
//
//   2. **回傳的是整隻生物**，不是頭像那種解析後的單一欄位：列表與詳情頁要的是同一份
//      CreatureDetailDto，寫入之後重新讀一次才拿得到「此刻真正生效」的那一份。

/** `creatures/{creatureId}/{random}.{ext}`，由 server 產生，理由見 `buildBlobPathname`。 */
export function buildCreaturePhotoPathname(creatureId: string, extension: string): string {
  return buildBlobPathname('creatures', creatureId, extension)
}

async function deleteQuietly(store: ImageBlobStore, url: string): Promise<void> {
  await deleteBlobQuietly(store, url, 'creature-photo')
}

/**
 * 上傳一張新照片並讓 `Creature.photoUrl` 指向它，回傳更新後的那一隻。
 * 查不到（不存在、不是你的、缸已封存）時回 `null`——呼叫端把它折成 404。
 *
 * ── 為什麼是 compare-and-set 而不是 `update` ──
 *
 * 兩個上傳同時在飛（連點兩下、兩個分頁）時，`update` 的結果只取決於誰**最後**寫到，
 * 而那與誰的照片比較新無關：先讀到舊值、慢一步才寫入的那個請求會把新的蓋掉，
 * 使用者看到的是上一張照片，而剛選的那一張的 Blob 沒人指向、也沒人刪。
 *
 * `updateMany({ where: { id, photoUrl: 讀到的舊值, tank: … } })` 讓資料庫自己判斷：
 * `count === 1` 才代表這一份是接在自己讀到的那個狀態之後。輸的那一方不重試、不覆蓋，
 * 只把自己剛上傳的 Blob 收掉——與 `saveCustomAvatar`（#166）同一個手法。
 */
export async function saveCreaturePhoto(
  client: PrismaClient,
  creatureId: string,
  userId: string,
  file: ValidatedImage,
  store: ImageBlobStore,
): Promise<CreatureDetailDto | null> {
  const current = await getCreatureDetail(client, creatureId, userId)

  // 這一隻不在了（或本來就不是你的）就連上傳都不必開始——
  // 沒有東西可以指向的 Blob 一建立就是 orphan
  if (!current) {
    return null
  }

  const previousUrl = current.photoUrl
  const uploaded = await store.put(
    buildCreaturePhotoPathname(creatureId, file.extension),
    file.data,
    file.contentType,
  )

  let claimed: number

  try {
    const claim = await client.creature.updateMany({
      where: { id: creatureId, photoUrl: previousUrl, tank: { userId, archivedAt: null } },
      data: { photoUrl: uploaded.url },
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
    // 併發的輸家，或這一瞬間歸屬變了：資料庫上不是自己讀到的那個狀態，
    // 這一張沒有人指向，收掉自己的就好
    await deleteQuietly(store, uploaded.url)
  }
  else if (previousUrl) {
    // 贏了才刪舊的，而且是在資料庫已經改指向新 URL **之後**。
    // 反過來先刪的話，寫入失敗時使用者會連原本那張都沒有了。
    //
    // 「舊檔案怎麼處理」是 issue #154 要一併決定的事，這裡採**立即刪除**：
    // 舊照片沒有任何畫面讀得到，留著只會讓 store 單調遞增（與頭像同一個決定）。
    await deleteQuietly(store, previousUrl)
  }

  // 回應一律來自寫入之後重新讀到的那一列：輸家因此回報的是目前真正生效的照片，
  // 而不是它自己那張已經被刪掉的圖。
  return await getCreatureDetail(client, creatureId, userId)
}

/**
 * 清掉 `Creature.photoUrl` 並 best-effort 收掉那個 Blob，回傳更新後的那一隻。
 * 查不到時回 `null`——呼叫端把它折成 404。
 *
 * 三個順序上的決定與 `removeCustomAvatar`（#167）完全相同：
 *
 * 1. **要刪哪一個只從 DB 讀。** 呼叫端連一個能傳 URL 的參數都沒有。接受 client 指定的話，
 *    任何人都能拿別人的 Blob URL 來刪別人的圖。
 *
 * 2. **先清 DB，再刪 Blob。** 反過來的話，Blob 刪掉但 DB 清除失敗，畫面會停在一個指向
 *    已不存在檔案的破圖 URL——比「照片還在」難救得多。
 *
 * 3. **compare-and-set，不是無條件 `update`。** 讀到舊值之後、寫入之前若有一次上傳插進來，
 *    無條件寫 null 會把剛上傳那一張變成沒有人指向的孤兒。
 */
export async function removeCreaturePhoto(
  client: PrismaClient,
  creatureId: string,
  userId: string,
  store: ImageBlobStore,
): Promise<CreatureDetailDto | null> {
  const current = await getCreatureDetail(client, creatureId, userId)

  if (!current) {
    return null
  }

  const previousUrl = current.photoUrl

  // 本來就沒有照片：冪等地成功。不寫入、不刪除、也不回 404——
  // 連按兩次「移除」不該有第二次的錯誤。
  if (!previousUrl) {
    return current
  }

  const cleared = await client.creature.updateMany({
    where: { id: creatureId, photoUrl: previousUrl, tank: { userId, archivedAt: null } },
    data: { photoUrl: null },
  })

  if (cleared.count === 1) {
    await deleteQuietly(store, previousUrl)
  }

  // 與上傳同一個作法：回應來自寫入之後重新讀到的那一列，而不是上面那份可能已經過期的快照
  return await getCreatureDetail(client, creatureId, userId)
}
