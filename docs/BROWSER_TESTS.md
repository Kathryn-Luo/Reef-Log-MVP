# 真實瀏覽器的測試（`tests/browser/`）

issue #176。這份說明存在的理由是：`tests/browser/` 底下有一支**現在跑不起來**的測試，
而「為什麼放著不跑」比那支測試本身更需要寫下來。

---

## 現況

| 目錄 | 跑在哪 | 由誰執行 |
|---|---|---|
| `tests/unit/` | happy-dom | `pnpm test`，TDD Develop 的 job 內 |
| `tests/e2e/` | 真的 Chromium + Vercel preview | `pnpm test:e2e`，preview 部署好之後 |
| `tests/browser/` | 真的 Chromium，**不需要 server、不需要登入** | 尚未啟用 |

第三列是 issue #176 開出來的缺口。`app/utils/avatarImage.ts` 的 `resizeAvatar`
整段建立在三個只有真實瀏覽器才有的 API 上：

- `createImageBitmap(file, { imageOrientation: 'from-image' })`
- `canvas.getContext('2d').drawImage()`
- `canvas.toBlob('image/webp', 0.8)`

happy-dom 三個都沒有，所以 `tests/unit/app/resize-avatar.test.ts` 只能把它們換成替身
——它驗的是「我呼叫了替身、替身回了我安排好的東西」。原本這個缺口由 #169 的 E2E 補，
但 2026-08-12 決定**訪客不得上傳頭像**（Epic #160），而 preview 上唯一登得進去的身分
就是訪客（Google 不支援萬用字元 redirect URI），那條路因此沒了。

`tests/browser/` 把「需要真實瀏覽器」和「需要真實部署」拆開：縮圖只需要前者。

---

## 為什麼還沒啟用

要跑它得先裝 `@vitest/browser`。CLAUDE.md 規定**相依與 CI 設定一律由人類決定**，
agent 不自己加，所以這一輪只把「裝上去之後就能跑」的東西準備好：

- `tests/browser/resize-avatar.browser.ts`——三條 Then 的測試本體
- `tests/browser/support/exifJpeg.ts`——手工組出來的、帶 EXIF Orientation 的 JPEG fixture
- `tests/unit/browser/`——這兩份東西在 `pnpm test` 這一側的守門

檔名刻意是 `.browser.ts` 而不是 `.browser.test.ts`：vitest 預設只收 `*.test.*` 與
`*.spec.*`，所以它天生就不會被 `pnpm test` 收進來。不這樣做的話，就得往
`vitest.config.ts` 的 `exclude` 加一項——那份白名單是 issue #32 的防線
（`tests/unit/workflows/ci-runner-config.test.ts` 逐項鎖住它），
為了一個新目錄去放寬它，代價比一個檔名慣例大得多。

---

## 要啟用的話（人類的三件事）

### ① 裝開發相依

```sh
pnpm add -D @vitest/browser @vitest/browser-playwright
```

`@vitest/browser-playwright` 是 Vitest 4 把 provider 拆出去之後的套件名；
Vitest 3 以前是 `@vitest/browser` 內建 `provider: 'playwright'`。裝之前先確認當下版本的
API，本檔寫於 vitest 4.1。Playwright 本身（`@playwright/test`）已經在 devDependencies 裡。

### ② 新增 `vitest.browser.config.ts`

不共用 `vitest.config.ts`：那一份設 `environment: 'nuxt'`，而 `resizeAvatar` 沒有任何
Nuxt 相依，在瀏覽器裡再啟動一次 Nuxt 環境只是白付代價。

```ts
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/browser/**/*.browser.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
```

再加一個 script：

```json
"test:browser": "vitest run --config vitest.browser.config.ts"
```

### ③ CI 上跑得動 Chromium

`.github/workflows/` 內的 CI job 要多一步 `pnpm exec playwright install --with-deps chromium`，
然後執行 `pnpm test:browser`。**這一步 agent 不會做**（CLAUDE.md：CI 設定一律人類處理）。

> 附帶一提：`pnpm exec playwright install chromium` 在本 repo 的 runner 上實測可行
> （chromium-headless-shell，約 115 MB，一分鐘內下載完）。

---

## 這組測試驗什麼

`tests/browser/resize-avatar.browser.ts` 對應 issue #176 的三條 Then：

| Then | 測試 |
|---|---|
| 1024×768 → 長邊 512、維持 4:3、`image/webp` | 長邊縮到 512 px，維持 4:3，輸出是 image/webp |
| 200×150 → 尺寸不變（只縮不放） | 200×150 的圖維持原尺寸，不放大 |
| EXIF Orientation=6 → 方向與肉眼一致 | EXIF Orientation=6 的照片轉正之後才縮，深色角落落在右上 |

第三條是最有價值的那一條，也是唯一在 mock 底下**永遠測不出來**的那一條：EXIF 方向在
畫進 canvas 之後就消失了，「預覽是正的、上傳後躺著」在 happy-dom 裡不管怎麼寫都是綠的。

fixture 是手工組出來的一份 4 KB 灰階 baseline JPEG：存檔 1024×512 的橫幅、左上象限深色，
EXIF 標「順時針轉 90 度」。它同時帶著一份 `Orientation = 1` 的對照組——像素完全一樣、
只差 EXIF 裡的一個 byte。兩份解出來一樣的話，就代表這個瀏覽器根本沒讀 EXIF。

深色象限的用途是分辨**轉的方向**：只比長寬比的話，順時針 90 度與逆時針 90 度給的是
同一個答案，而那兩者在畫面上差了 180 度。

fixture 本身（合法的 JPEG 骨架、EXIF 真的有那個 tag、存檔真的是橫的、深色象限真的在左上）
由 `tests/unit/browser/exif-jpeg-fixture.test.ts` 在 `pnpm test` 裡驗，那一支現在就是綠的。

### 一個實測發現：`imageOrientation` 的預設值已經改了

驗 fixture 時順手量到的：Chromium 151 上 `createImageBitmap(file)` **不帶**
`imageOrientation` 選項，解出來的尺寸與帶了 `'from-image'` 一模一樣（都是 512×1024）。
規格後來把預設值從 `'none'` 改成了 `'from-image'`。

所以第三條 Then 證明的是「整條管線走完之後方向沒有掉」，**不是**「那個選項有送出去」。
選項仍然得留著——舊 WebKit 的預設不轉——而「它有沒有被順手拿掉」由
`tests/unit/app/resize-avatar.test.ts` 那條守著。兩邊守的是不同的東西，都需要。

### 這三條斷言的來源

它們不是照著規格猜的。實作這一輪時，用 `pnpm exec playwright install chromium` 裝好的
Chromium 151 跑過一次一次性的驗證器（把同樣的輔助函式與斷言搬進 `page.evaluate`），
量到的就是上表那些數字：

```
then1  { outcome: 'resized', size: { width: 512, height: 384 }, type: 'image/webp' }
then2  { outcome: 'resized', size: { width: 200, height: 150 } }
then3  { outcome: 'resized', size: { width: 256, height: 512 },
         luma: { topLeft: 248, topRight: 8, bottomLeft: 248, bottomRight: 248 } }
控制組 { outcome: 'resized', size: { width: 512, height: 256 } }
```

那個驗證器是拋棄式的、沒有進版控（它得自己用 esbuild 打包、自己開 Playwright，
與 `@vitest/browser` 的執行方式不同）。所以上面這段只是「斷言的數字有根據」的紀錄，
不等於這支測試已經在 CI 裡跑過。真正把它接起來還是要走上面那三步。
