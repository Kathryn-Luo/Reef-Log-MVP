import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const schema = () => readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const migrationsDir = resolve(process.cwd(), 'prisma/migrations')

function migrationContaining(needle: string): string | undefined {
  return readdirSync(migrationsDir)
    .map(directory => join(migrationsDir, directory, 'migration.sql'))
    .find((path) => {
      try {
        return readFileSync(path, 'utf8').includes(needle)
      }
      catch {
        return false
      }
    })
}

describe('User.lastActiveAt schema', () => {
  // Given 新建的訪客 User / When Prisma 建立該列
  // Then 資料庫會自動給出初始活動時間。
  it('User 有以資料庫時間為預設值的 lastActiveAt', () => {
    expect(schema()).toMatch(/lastActiveAt\s+DateTime\s+@default\(now\(\)\)/)
  })

  // Given 已存在的 production 使用者 / When 套用 migration
  // Then 他們也有一個非 null 的初始活動時間。
  it('migration 以非 null、CURRENT_TIMESTAMP 欄位加入 lastActiveAt', () => {
    const migration = migrationContaining('"lastActiveAt"')

    expect(migration).toBeDefined()
    expect(readFileSync(migration!, 'utf8')).toMatch(
      /ADD COLUMN "lastActiveAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/,
    )
  })
})
