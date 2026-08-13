import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// 真實瀏覽器裡的測試（issue #176，啟用說明見 docs/BROWSER_TESTS.md）。
//
// 為什麼不共用 vitest.config.ts：那一份設 `environment: 'nuxt'`，而 resizeAvatar
// 沒有任何 Nuxt 相依，在瀏覽器裡再啟動一次 Nuxt 環境只是白付代價。
//
// 也不能把 tests/browser/ 併進那一份的收檔範圍：`vitest.config.ts` 的 `exclude`
// 是 issue #32 的防線，由 tests/unit/workflows/ci-runner-config.test.ts 逐項鎖住
// （SAFE_EXCLUDES 只有 node_modules 與 tests/e2e）。為了一個新目錄去放寬那份白名單，
// 代價比多一支設定檔大得多。兩邊各自獨立，`pnpm test` 的收檔範圍一個字都沒動。
//
// 只跑 chromium。「要不要一併跑 WebKit 以涵蓋 Safari 專屬的坑」是還沒做的決定，
// 見 #176 的討論——PR #185 那次實機 bug（舊 WebKit 的 imageOrientation 列舉、
// toBlob 安靜退成 PNG）在 chromium 上是抓不到的。
/**
 * 逃生口：用已經裝在這台機器上的 Chromium，而不是 Playwright 指定版本的那一份。
 *
 * CI 上不會用到（`playwright install` 抓得到對應版本）。需要它的是沙盒式的開發
 * 環境——那裡預先裝好了某個版本的 Chromium，但對外只開放白名單網域，
 * `cdn.playwright.dev` 不在其中，於是 `playwright install` 一定失敗。
 * 沒有這個開關的話，那種環境**一條瀏覽器測試都跑不了**。
 *
 * 版本因此可能與 Playwright 預期的不一致。那是刻意的取捨：這幾條測試驗的是
 * canvas 與 createImageBitmap 這種十年沒動過的 API，版本差幾版不影響結論，
 * 而「完全跑不了」影響很大。CI 上仍然是對齊的那一份說了算。
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE

export default defineConfig({
  test: {
    include: ['tests/browser/**/*.browser.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(executablePath ? { launchOptions: { executablePath } } : {}),
      instances: [{ browser: 'chromium' }],
    },
  },
})
