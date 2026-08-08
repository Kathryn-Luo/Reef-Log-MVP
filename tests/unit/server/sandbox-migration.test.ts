// @vitest-environment node
// 純文字比對，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// `User.sandboxSeededAt` 那支 migration 的**回填**（issue #144）。
//
// 為什麼需要一支專門的測試：這一行是整個 PR 裡破壞力最大、卻完全沒有防線的一句。
// 把它刪掉不會有任何既有測試轉紅——
//
//   - CI 的 drift 檢查（.github/workflows/ci.yml 的 `prisma migrate diff
//     --from-migrations ... --to-schema-datamodel`）比的是 **datamodel**，
//     DML 對它完全隱形；
//   - unit 測試一行都沒讀 prisma/migrations/；
//   - E2E 在 preview 上只建全新的訪客，走不到「既有使用者」那條路徑。
//
// 而刪掉的後果是：所有既有使用者的 sandboxSeededAt 留在 null → 下次看到空清單時
// 被判定成「還欠一份沙盒」→ 再複製一份 → 缸與生物直接變兩倍。
//
// 這裡只驗得到「那句話還在」，驗不到「它在真的資料庫上跑對了」——後者要有資料庫，
// 而這個 job 連不到（與 auth-wiring.test.ts 同樣的分工）。但「還在不在」正是
// 這一行最可能出事的方式：它讀起來像一句可有可無的清理。

const MIGRATION = 'prisma/migrations/20260807120000_add_user_sandbox_seeded_at/migration.sql'

const sql = () => readFileSync(resolve(process.cwd(), MIGRATION), 'utf8')

describe('sandboxSeededAt 的 migration', () => {
  it('加上這一欄，而且是可為 null 的', () => {
    // 不能有 NOT NULL / DEFAULT：新訪客必須是 null，那正是「還欠一份沙盒」的表示法
    expect(sql()).toMatch(/ALTER TABLE "User" ADD COLUMN "sandboxSeededAt" TIMESTAMP\(3\);/)
    expect(sql()).not.toMatch(/"sandboxSeededAt"[^;]*NOT NULL/)
    expect(sql()).not.toMatch(/"sandboxSeededAt"[^;]*DEFAULT/)
  })

  // 這一條就是整支測試存在的理由
  it('把既有使用者一併回填，不留任何一列是 null', () => {
    expect(
      sql(),
      '回填不見了：既有使用者會被判定成「還欠一份沙盒」，下次看到空清單就再複製一份',
    ).toMatch(/UPDATE "User"\s+SET "sandboxSeededAt" = "createdAt"/)
  })

  // 回填要取 createdAt 而不是 now()：這一欄的用途之一是「什麼時候好的」，
  // 全部戳上 migration 執行的那一刻等於把既有使用者的時間資訊抹平
  it('回填取的是各自的 createdAt', () => {
    expect(sql()).not.toMatch(/SET "sandboxSeededAt" = (now\(\)|CURRENT_TIMESTAMP)/i)
  })
})
