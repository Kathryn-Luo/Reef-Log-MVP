import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'http://localhost:3000'

// 部分沙盒環境預裝固定版本的 chromium，與 @playwright/test 預期下載的版本不同；
// 若該路徑存在就直接使用，避免嘗試下載瀏覽器。一般 CI / 本機不受影響。
const sandboxChromium = '/opt/pw-browsers/chromium'
const executablePath = existsSync(sandboxChromium) ? sandboxChromium : undefined

// E2E 依 CLAUDE.md 跑在 preview URL 上：由 PLAYWRIGHT_TEST_BASE_URL 指定該次 PR 的
// NuxtHub / Cloudflare preview URL；本機開發預設打 `nuxt dev`。
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } },
    },
  ],
})
