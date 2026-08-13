# 真實瀏覽器的測試（`tests/browser/`）

issue #176。`resizeAvatar` 那段程式碼有一條只有真實瀏覽器驗得到的規格，
而它原本的覆蓋來源被授權規則堵死了。這份說明記的是那個缺口、補法，以及補法的邊界。

**2026-08-13 起已啟用**（`pnpm test:browser`，CI 每個 PR 都會跑）。

---

## 現況

| 目錄 | 跑在哪 | 由誰執行 |
|---|---|---|
| `tests/unit/` | happy-dom | `pnpm test`，TDD Develop 的 job 內 |
| `tests/e2e/` | 真的 Chromium + Vercel preview | `pnpm test:e2e`，preview 部署好之後 |
| `tests/browser/` | 真的 Chromium，**不需要 server、不需要登入** | `pnpm test:browser`，CI 的 `lint-typecheck-test` job 內 |

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

## 怎麼跑

```sh
pnpm test:browser
```

CI 的 `lint-typecheck-test` job 在 unit 測試之後、build 之前跑同一個指令，
前面加一步 `pnpm exec playwright install --with-deps chromium`。

相依是 `@vitest/browser` 與 `@vitest/browser-playwright`（Vitest 4 把 provider 拆出去
之後的套件名；Vitest 3 以前是 `@vitest/browser` 內建 `provider: 'playwright'`）。
Playwright 本身（`@playwright/test`）本來就在 devDependencies 裡。

設定在 `vitest.browser.config.ts`，**不共用** `vitest.config.ts`，有兩個理由：

1. 那一份設 `environment: 'nuxt'`，而 `resizeAvatar` 沒有任何 Nuxt 相依，在瀏覽器裡
   再啟動一次 Nuxt 環境只是白付代價。
2. 更重要的：那一份的 `exclude` 是 issue #32 的防線，由
   `tests/unit/workflows/ci-runner-config.test.ts` 逐項鎖住（白名單只有 `node_modules`
   與 `tests/e2e`）。把 `tests/browser/` 塞進去要放寬那份白名單，代價比多一支設定檔大。

同一個理由，檔名刻意是 `.browser.ts` 而不是 `.browser.test.ts`：vitest 預設只收
`*.test.*` 與 `*.spec.*`，所以它天生就不會被 `pnpm test` 收進來。`pnpm test` 的收檔
範圍到現在一個字都沒有動過。

### 在下載不到 Chromium 的環境裡

有些開發環境（例如只開放白名單網域的沙盒）連不到 `cdn.playwright.dev`，
`playwright install` 一定失敗，但機器上往往已經預先裝了某個版本的 Chromium。
這種情況給一個絕對路徑就跑得起來：

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium-1194/chrome-linux/chrome pnpm test:browser
```

版本因此可能與 Playwright 預期的不一致。那是刻意的取捨：這幾條測試驗的是 canvas 與
`createImageBitmap` 這種十年沒動過的 API，差幾版不影響結論，而「完全跑不了」影響很大。
CI 上不會用到這個開關，那裡仍然是版本對齊的那一份說了算。

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

它們不是照著規格猜的。建立這組測試時（PR #186 的第一輪，`@vitest/browser` 還沒核准），
先用一次性的驗證器在 Chromium 151 上量過一次，數字就是上表那些。

那個驗證器已經沒有用了——**這組測試現在真的跑在 `pnpm test:browser` 裡**，
斷言由 vitest 自己驗證，不再需要旁證。

---

## 這組測試守不到的東西

**它只跑 Chromium，所以抓不到 Safari 專屬的坑。**

這不是假設。PR #185 上線前的實機測試就踩到兩個，兩個在 Chromium 上都是綠的：

- `imageOrientation` 的 `'from-image'` 是後來才加進規格的列舉值，只認得 `'none'` /
  `'flipY'` 的舊 WebKit 會在 WebIDL 轉換那一步丟 `TypeError`——不是忽略選項，是整個
  `createImageBitmap` 呼叫失敗。
- `toBlob` 編不出 WebP 時**不會失敗**，它安靜地回一份 PNG。

`resizeAvatar` 現在對這兩者各有一條退路（`de84217`），而守著那兩條退路的仍然是
`tests/unit/app/resize-avatar.test.ts` 裡的替身——真實環境的驗證只有人工實機。

### 決定：不把 WebKit 加進 CI（issue #187，2026-08-13）

可以讓 `vitest.browser.config.ts` 的 `instances` 多一個 `webkit`，但**決定不做**。

理由不是成本，是訊號品質：Linux 上的 Playwright WebKit 不等於真的 iOS Safari
（引擎版本與系統編解碼器都不同），WebKit 專屬的失敗常常分不清是真 bug 還是
provider 差異——而分不清的紅燈會慢慢被當成雜訊忽略，那比沒有測試更糟。

所以這一類明文交給**人工實機**確認。既然是人工，就得處理「人工最容易失敗的地方是
沒人想起來」：

> CI 有一步 `Cross-browser reminder`，在 PR 動到 `app/utils/avatarImage.ts` 時
> 留下一則 warning 與一段 run summary，說明要在實機確認什麼。
> 它永遠成功——是提醒，不是閘門。

要確認的就一件事：選一張相機拍的橫向照片，上傳後方向正確，而且沒有跳出
「無法縮小」之類的訊息（那四句訊息各對應一個失敗的關卡，見 `app/pages/profile.vue`
的 `OVERSIZED_MESSAGES`）。

那一步是 `if` 條件下的步驟，掉了不會有任何紅燈，所以由
`tests/unit/browser/resize-avatar-browser-spec.test.ts` 守著它還在。
