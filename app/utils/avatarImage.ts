// 上傳前的等比縮圖（issue #168）。
//
// 為什麼住在 `app/utils/` 而不是 `shared/`：整段仰賴 `createImageBitmap` 與 canvas，
// 那兩樣只有瀏覽器有。放進 shared 的話，server 端某天不小心 import 進去就會炸在
// 執行期，而型別上完全看不出來。
//
// 為什麼要縮：Epic #160（2026-08-12）把「超過 2 MB 就退件」改成「前端一律縮好再送」。
// 手機拍的照片通常 3–8 MB，而本輪不做裁切工具——不縮的話，使用者從相簿隨手挑一張
// 就必然失敗，且沒有任何補救手段。2 MB 因此退回 server 端當安全上限
// （`shared/utils/avatarUpload.ts`），使用者正常操作永遠碰不到它。
//
// ⚠ 這一支**不是**安全邊界。它可以被繞過（直接打 API），所以 server 端的三道檢查
// 一條都不能因為「反正前端縮過了」而放寬。

/** 長邊上限。頭像顯示尺寸不到 128 px，512 已經足夠 2× 螢幕再裁切 */
export const AVATAR_MAX_EDGE = 512

/** 輸出格式。三種允許格式裡壓縮率最好的那一個（同畫質約為 JPEG 的 2/3） */
export const AVATAR_OUTPUT_TYPE = 'image/webp'

/** 0.8：再往下人臉會開始出現色塊，再往上檔案變大但看不出差別 */
export const AVATAR_OUTPUT_QUALITY = 0.8

/**
 * 送出時的檔名。真正決定 Blob pathname 的是 server（見 `buildAvatarPathname`），
 * 這個名字只用來讓 multipart 的那一段有副檔名可讀——而 server 的三道檢查裡有一道
 * 正是「副檔名要對得上 MIME」。
 */
export const AVATAR_OUTPUT_FILENAME = 'avatar.webp'

/** 長邊縮到 `AVATAR_MAX_EDGE`，等比、**只縮不放**（已經很小的圖維持原尺寸） */
function fitWithin(width: number, height: number): { width: number, height: number } {
  const longestEdge = Math.max(width, height)

  if (longestEdge <= AVATAR_MAX_EDGE) {
    return { width, height }
  }

  const scale = AVATAR_MAX_EDGE / longestEdge

  // 至少留 1 px：極端長寬比（例如 4000 × 3）的短邊四捨五入會變成 0，那是一張畫不出來的畫布
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function encode(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, AVATAR_OUTPUT_TYPE, AVATAR_OUTPUT_QUALITY))
}

/**
 * 把使用者選的照片縮成長邊 512 px 的 WebP。
 *
 * **失敗一律回傳原本的 `File`，不丟例外。** 瀏覽器不支援、檔案解不開、編碼器給不出
 * WebP……每一種都還有一條路可以走：把原檔送出去，讓 server 判。在這裡丟例外只會把
 * 使用者卡在一個他無能為力的錯誤上——而 Android 各家 picker 對 `accept` 的遵守程度
 * 不一，本來就會有非預期格式送進來。
 *
 * 方向靠 `imageOrientation: 'from-image'`，在**解碼那一刻**就套用 EXIF。
 * 先塞進 `<img>` 再 `drawImage` 的話方向資訊已經沒了，會出現「預覽是正的、上傳後躺著」。
 */
export async function resizeAvatar(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })

    try {
      const { width, height } = fitWithin(bitmap.width, bitmap.height)
      const canvas = document.createElement('canvas')

      canvas.width = width
      canvas.height = height

      const context = canvas.getContext('2d')

      // 沒有 2D context 就沒有畫布可畫——這個瀏覽器做不到，送原檔
      if (!context) {
        return file
      }

      context.drawImage(bitmap, 0, 0, width, height)

      const blob = await encode(canvas)

      // toBlob 給不出東西，或給的不是 WebP（不支援 WebP 編碼的瀏覽器會自己退回 PNG）。
      // 後者不能頂著 .webp 的檔名送出去：server 要 MIME、副檔名、magic bytes 三者一致，
      // 掛錯名字會被當成「格式不支援」退件，而使用者換幾張圖都一樣。
      if (!blob || blob.type !== AVATAR_OUTPUT_TYPE) {
        return file
      }

      return new File([blob], AVATAR_OUTPUT_FILENAME, { type: AVATAR_OUTPUT_TYPE })
    }
    finally {
      // 解碼出來的點陣圖佔的是實體記憶體，等 GC 太慢——一張 4032 × 3024 就是 48 MB
      bitmap.close()
    }
  }
  catch {
    return file
  }
}
