// @vitest-environment node
// 純文字比對，不需要 Nuxt 環境；理由見 workflows/test-environment.test.ts（issue #38）

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// 渲染模式與部署 preset（issue #84）。
//
// 這兩件事都是「改了不會有任何測試紅、但線上會壞」的設定，所以在這裡各釘一條。
// 手法與 authorization-wiring.test.ts 相同：讀原始碼本文——nuxt.config.ts 在
// vitest 裡 import 不進來（defineNuxtConfig 是 Nuxt 建置期的全域）。

const source = readFileSync(resolve(process.cwd(), 'nuxt.config.ts'), 'utf8')

describe('nuxt.config.ts', () => {
  // 為什麼要關 SSR（#84）：每一頁都要登入，SSR 能先送出的只是等資料的骨架；
  // #67 之後爬蟲爬 `/` 一律落在登入頁，SEO 也拿不到好處。
  //
  // 而它有實際成本：SSR 那一次請求是**伺服器代替使用者**發的，cookie 不會自動跟著走。
  // PR #82 把 `GET /api/tanks` 的「沒有身分」從 200 空清單改成 401 之後，SSR 期間那次
  // 無身分的請求就撞上 401 → $api 的攔截器導去 /login → route middleware 從 cookie
  // 讀得到 session 又導回 / → 已登入的人陷入無限導向。
  //
  // 有人「順手打開看看」的話，同一個 bug 會整批回來，所以這一條要紅得夠明白。
  it('關閉 SSR（走 SPA）', () => {
    expect(source).toMatch(/^\s*ssr:\s*false,/m)
  })

  // CLAUDE.md 的硬約束：Prisma 6 是非 edge 寫法，落到 vercel-edge 會在執行期 crash。
  // 關掉 SSR 不影響這件事——server/api/** 與 server/routes/** 仍然由 Nitro 提供。
  //
  // 比對的是設定值本身，不是整份檔案有沒有出現 'vercel-edge'——那個字串正大光明地
  // 寫在旁邊的註解裡（「preset 必須為 Node（非 vercel-edge）」），連註解一起比的話，
  // 把理由寫清楚反而會讓測試轉紅。
  it('Nitro preset 仍是 vercel（Node），不是 vercel-edge', () => {
    expect(source).toMatch(/preset:\s*'vercel'/)
    expect(source).not.toMatch(/preset:\s*'vercel-edge'/)
  })
})
