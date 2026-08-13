// 上傳前的等比縮圖（issue #168；issue #154 起也服務生物照片）。
//
// 為什麼住在 `app/utils/` 而不是 `shared/`：整段仰賴 `createImageBitmap` 與 canvas，
// 那兩樣只有瀏覽器有。放進 shared 的話，server 端某天不小心 import 進去就會炸在
// 執行期，而型別上完全看不出來。
//
// 為什麼引擎（`resizeImage`）留在這個檔名底下，而不是搬進一支中性的 `imageResize.ts`：
// `.github/workflows/ci.yml` 的「跨瀏覽器提醒」盯的正是這個路徑（issue #187），
// tests/browser 的真實瀏覽器覆蓋（#176）也是從這裡 import。搬走的話，改到縮圖邏輯
// 就不再有人被提醒去實機確認一次——而那道提醒存在的理由是 PR #185 踩過的兩個坑
// （imageOrientation 的列舉、toBlob 安靜退成 PNG）都只在真實裝置上看得到。
// 生物照片那一組設定因此住在 `creaturePhotoImage.ts`，只帶參數過來。
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

/** 首選輸出格式。三種允許格式裡壓縮率最好的那一個（同畫質約為 JPEG 的 2/3） */
export const AVATAR_OUTPUT_TYPE = 'image/webp'

/**
 * 一次縮圖的設定：長邊上限，與送出時那份檔案的名字前綴。
 *
 * 檔名只用來讓 multipart 那一段有副檔名可讀（真正的 Blob pathname 由 server 產生），
 * 但副檔名**必須跟著實際 MIME 走**——見 `OUTPUT_FORMATS`。
 */
export interface ImageResizeOptions {
  maxEdge: number
  /** `photo` → `photo.webp` / `photo.jpg` */
  filenameBase: string
}

/**
 * 依序嘗試的輸出格式，第一個編得出來的就是送出的那一份。
 *
 * 副檔名必須跟著 MIME 走：server 的三道檢查要 MIME、副檔名、magic bytes 三者一致
 *（`shared/utils/avatarUpload.ts`），一份 JPEG 頂著 `.webp` 的名字會被當成
 * 「格式不支援」退件，而使用者換幾張圖都一樣。
 *
 * 為什麼需要第二順位：`toBlob` 編不出 WebP 時**不會失敗**，它安靜地回一份 PNG，
 * 沒有任何管道說「我換格式了」。舊版 Safari 就是這個行為。只認 WebP 的話，
 * 那些裝置會整批退到「送原檔」——而手機相機的原檔本來就超過 2 MB。
 */
const OUTPUT_FORMATS = [
  { type: AVATAR_OUTPUT_TYPE, extension: 'webp' },
  { type: 'image/jpeg', extension: 'jpg' },
] as const

/** 0.8：再往下人臉會開始出現色塊，再往上檔案變大但看不出差別 */
export const AVATAR_OUTPUT_QUALITY = 0.8

/** 頭像的設定。長邊 512、檔名 avatar.webp（退到 JPEG 時是 avatar.jpg）。 */
export const AVATAR_RESIZE_OPTIONS: ImageResizeOptions = {
  maxEdge: AVATAR_MAX_EDGE,
  filenameBase: 'avatar',
}

/**
 * 首選格式送出時的檔名。真正決定 Blob pathname 的是 server（見 `buildAvatarPathname`），
 * 這個名字只用來讓 multipart 的那一段有副檔名可讀——而 server 的三道檢查裡有一道
 * 正是「副檔名要對得上 MIME」。退到 JPEG 時檔名也跟著換，見 `OUTPUT_FORMATS`。
 */
export const AVATAR_OUTPUT_FILENAME = `${AVATAR_RESIZE_OPTIONS.filenameBase}.${OUTPUT_FORMATS[0].extension}`

/** 長邊縮到 `maxEdge`，等比、**只縮不放**（已經很小的圖維持原尺寸） */
function fitWithin(width: number, height: number, maxEdge: number): { width: number, height: number } {
  const longestEdge = Math.max(width, height)

  if (longestEdge <= maxEdge) {
    return { width, height }
  }

  const scale = maxEdge / longestEdge

  // 至少留 1 px：極端長寬比（例如 4000 × 3）的短邊四捨五入會變成 0，那是一張畫不出來的畫布
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, AVATAR_OUTPUT_QUALITY))
}

/**
 * 依序試 `OUTPUT_FORMATS`，回傳第一個「真的編出該格式」的結果。
 *
 * 判斷方式只能是比對 `blob.type`：編不出來時 `toBlob` 回的是一份 PNG，不是 null，
 * 所以「有拿到東西」不代表拿到的是要的東西。
 */
async function encodeSmallest(canvas: HTMLCanvasElement, filenameBase: string): Promise<File | null> {
  for (const format of OUTPUT_FORMATS) {
    const blob = await encode(canvas, format.type)

    if (blob?.type === format.type) {
      return new File([blob], `${filenameBase}.${format.extension}`, { type: format.type })
    }
  }

  return null
}

/**
 * 解碼成點陣圖，方向盡量套用 EXIF。
 *
 * `imageOrientation: 'from-image'` 是後來才加進規格的列舉值。只認得 'none' / 'flipY'
 * 的舊 WebKit 會在 WebIDL 的列舉轉換那一步**丟 TypeError**——不是忽略選項，是整個
 * 呼叫失敗。少了這條退路，那些裝置一張照片都縮不動。
 *
 * 退路犧牲的是自動轉正（橫拍的照片可能躺著），換到的是「縮得動」。兩者相比，
 * 躺著的頭像至少存得進去，使用者還能自己轉正再上傳一次；縮不動則是完全走不通。
 */
async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  }
  catch {
    return await createImageBitmap(file)
  }
}

/**
 * 這一次縮圖的結果，`'resized'` 以外都代表「回傳的是原檔」。
 *
 * 為什麼要分得這麼細：這幾條路徑只在**真實裝置**上才走得到，而那裡沒有 console 可看。
 * 呼叫端把它翻成各自不同的一句話顯示出來，一張截圖就足以判斷是哪一關卡住——
 * 少了它，遠端只能靠猜（#168 的實機回報已經為此多繞了兩輪）。
 */
export type ImageResizeOutcome
  /** 縮好了，回傳的是重新編碼的那一份 */
  = 'resized'
    /** 兩種解碼方式都失敗：這個瀏覽器讀不開這個檔案 */
    | 'decode-failed'
    /** 拿不到 2D context：這個瀏覽器沒有可用的 canvas */
    | 'no-canvas-context'
    /** WebP 與 JPEG 都編不出來，或 toBlob 直接回 null */
    | 'encode-failed'

export interface ImageResizeResult {
  /** 該送出的那一份。`outcome !== 'resized'` 時就是傳進來的原檔本身 */
  file: File
  outcome: ImageResizeOutcome
}

/** 頭像那一組的別名，保留原本的名字（issue #168 之後的呼叫端都用它）。 */
export type AvatarResizeOutcome = ImageResizeOutcome
export type AvatarResizeResult = ImageResizeResult

/**
 * 把使用者選的照片縮成長邊 `options.maxEdge` 的 WebP。
 *
 * **失敗一律回傳原本的 `File`，不丟例外。** 瀏覽器不支援、檔案解不開、編碼器給不出
 * WebP……每一種都還有一條路可以走：把原檔送出去，讓 server 判。在這裡丟例外只會把
 * 使用者卡在一個他無能為力的錯誤上——而 Android 各家 picker 對 `accept` 的遵守程度
 * 不一，本來就會有非預期格式送進來。
 *
 * 方向靠 `imageOrientation: 'from-image'`，在**解碼那一刻**就套用 EXIF。
 * 先塞進 `<img>` 再 `drawImage` 的話方向資訊已經沒了，會出現「預覽是正的、上傳後躺著」。
 */
export async function resizeImage(file: File, options: ImageResizeOptions): Promise<ImageResizeResult> {
  let bitmap: ImageBitmap

  try {
    bitmap = await decode(file)
  }
  catch {
    return { file, outcome: 'decode-failed' }
  }

  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, options.maxEdge)
    const canvas = document.createElement('canvas')

    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')

    // 沒有 2D context 就沒有畫布可畫——這個瀏覽器做不到，送原檔
    if (!context) {
      return { file, outcome: 'no-canvas-context' }
    }

    context.drawImage(bitmap, 0, 0, width, height)

    const encoded = await encodeSmallest(canvas, options.filenameBase)

    // WebP、JPEG 都編不出來（或 toBlob 直接回 null）才走原檔那條路
    return encoded
      ? { file: encoded, outcome: 'resized' }
      : { file, outcome: 'encode-failed' }
  }
  catch {
    // drawImage 也可能丟（來源畫布被污染、尺寸算出 0），一樣不往外拋
    return { file, outcome: 'encode-failed' }
  }
  finally {
    // 解碼出來的點陣圖佔的是實體記憶體，等 GC 太慢——一張 4032 × 3024 就是 48 MB
    bitmap.close()
  }
}

/** 頭像：長邊 512 px 的 WebP。設定見 `AVATAR_RESIZE_OPTIONS`，行為見 `resizeImage`。 */
export async function resizeAvatar(file: File): Promise<AvatarResizeResult> {
  return await resizeImage(file, AVATAR_RESIZE_OPTIONS)
}
