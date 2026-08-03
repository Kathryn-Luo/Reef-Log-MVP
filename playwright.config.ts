import { defineConfig, devices } from '@playwright/test'

// CI 上針對 Vercel Preview URL 執行（由 workflow 注入 PLAYWRIGHT_BASE_URL），
// 本機開發則自動起 nuxt dev。
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',

  // Playwright 的預設 timeout（test 30 秒、expect 5 秒）是「對本機 dev server」的量級。
  // 這裡跑的是 Vercel preview：冷啟的 serverless function + Neon 的連線建立，
  // 實測 5 次「按下訪客登入 → 首頁真的有資料」是 13.7～21.1 秒（issue #95）。
  // 一條 test 裡只要開兩位訪客，30 秒就必定不夠。
  //
  // 90 秒是「一次訪客登入的觀測上限（21 秒）再加上 test 本體的操作」還有餘裕的量級，
  // 同時不會讓真的壞掉的 case 拖太久——CI 上 retries 是 2，最慢的失敗路徑約 4.5 分鐘。
  timeout: 90_000,

  expect: {
    // SPA（#84）下 `expect(...).toBeVisible()` 等的往往不是渲染，而是該頁自己的
    // `useAsyncData` 去 preview 要一次資料（實測 +1.5～3 秒）。5 秒的預設餘裕太薄，
    // 慢的那幾次會變成看起來像斷言失敗的逾時。
    timeout: 15_000,
  },

  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
      },
})
