import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const schema = () => readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8')

describe('User.lastActiveAt schema', () => {
  // Given 新建的訪客 User / When Prisma 建立該列
  // Then 資料庫會自動給出初始活動時間。
  it('User 有以資料庫時間為預設值的 lastActiveAt', () => {
    expect(schema()).toMatch(/lastActiveAt\s+DateTime\s+@default\(now\(\)\)/)
  })
})
