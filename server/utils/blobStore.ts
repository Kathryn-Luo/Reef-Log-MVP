import { randomUUID } from 'node:crypto'
import { del, put } from '@vercel/blob'

// Blob store 的共用底座（issue #154 從 avatarStore.ts 抽出）。
//
// 頭像（#166）與生物照片（#154）對 store 的需求一模一樣：放上去、刪掉、路徑由 server
// 產生。差別只在路徑前綴與「哪一欄指向它」，那些留在各自的 store 模組裡。
//
// ⚠ token 不出現在這個檔案裡。`@vercel/blob` 預設讀部署環境的 `BLOB_READ_WRITE_TOKEN`，
// 而那個值在 Vercel 上依 Production / Preview 兩個 scope 各設一份（由人類維護），
// 於是「production 與 preview 各自打到自己的 store」是環境給的，不是程式碼判斷的。
// 這一點很要緊：preview 的 Neon 分支是從 production 複製來的，可能帶著**一模一樣的**
// id 與圖片 URL，共用 token 的話 preview 的一次刪除就會打掉正式環境的圖片。
// 也因此它絕不能進 `runtimeConfig.public` 或任何前端 bundle。

/**
 * Blob store 的最小介面——這一層只需要「放上去」與「刪掉」兩件事。
 *
 * 抽這一層不是為了將來換供應商，而是為了讓幾條失敗路徑測得到：直接呼叫 `put` / `del`
 * 的話，「DB 失敗時剛建立的 Blob 有沒有被刪掉」只能靠對 `@vercel/blob` 下 module mock
 * 才驗得出來，而那驗到的是 mock 的形狀，不是流程。
 */
export interface ImageBlobStore {
  put: (pathname: string, data: Uint8Array, contentType: string) => Promise<{ url: string }>
  delete: (url: string) => Promise<void>
}

/** 正式的實作。`@vercel/blob` 只在這裡出現一次。 */
export const vercelImageBlobStore: ImageBlobStore = {
  async put(pathname, data, contentType) {
    // `PutBody` 收 Buffer 而不是 Uint8Array。這是零複製的檢視：multipart 給的本來就是
    // 一個 Buffer，這裡只是把型別接回去，不會再把整張圖抄一份。
    const body = Buffer.from(data.buffer, data.byteOffset, data.byteLength)

    // addRandomSuffix: false —— 隨機的部分已經在 pathname 裡（見 buildBlobPathname），
    // 兩邊都加只會讓 URL 更長，也讓「這張圖是誰的」在 store 裡更難看出來。
    const { url } = await put(pathname, body, { access: 'public', contentType, addRandomSuffix: false })

    return { url }
  },

  async delete(url) {
    await del(url)
  },
}

/**
 * `{prefix}/{ownerId}/{random}.{ext}` —— **由 server 產生**，使用者送來的檔名一個字都不用。
 *
 * 兩件事各自要命：
 *   - 檔名來自使用者的話，`../` 與控制字元就跟著進了 store 的路徑。
 *   - 路徑固定的話（例如 `avatars/{userId}.png`），換圖會覆寫同一個 URL，
 *     而 Blob 是 immutable + CDN 快取——瀏覽器會繼續顯示舊圖，看起來像「換不掉」。
 *     所以每次上傳都是一個**新的**隨機路徑。
 */
export function buildBlobPathname(prefix: string, ownerId: string, extension: string): string {
  return `${prefix}/${ownerId}/${randomUUID()}.${extension}`
}

/** 刪不掉不是這次請求的錯：舊圖留著只是佔空間，把它變成 500 才是把成功的上傳弄丟。 */
export async function deleteQuietly(store: ImageBlobStore, url: string, label: string): Promise<void> {
  try {
    await store.delete(url)
  }
  catch (cause) {
    // best-effort：這裡刻意不往外拋，也不改變呼叫端的結果。
    // 但也不能完全沒有痕跡——留不下來的 Blob 只有 log 記得，孤兒才查得出來（issue #167）。
    console.warn(`[${label}] Blob 刪除失敗，略過（資料庫已是最新狀態）`, url, cause)
  }
}
