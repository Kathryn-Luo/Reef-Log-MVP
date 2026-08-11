// @vitest-environment node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATION = 'prisma/migrations/20260811080000_add_maintenance_task_created_on/migration.sql'

const sql = () => readFileSync(resolve(process.cwd(), MIGRATION), 'utf8')

describe('MaintenanceTask.createdOn 的 migration', () => {
  it('新增可為 null 且沒有資料庫 default 的 DATE 欄位', () => {
    expect(sql()).toMatch(/ALTER TABLE "MaintenanceTask" ADD COLUMN "createdOn" DATE;/)
    expect(sql()).not.toMatch(/"createdOn"[^;]*NOT NULL/)
    expect(sql()).not.toMatch(/"createdOn"[^;]*DEFAULT/)
  })

  it('既有任務以各自的 UTC createdAt 日期做保守回填', () => {
    expect(sql()).toMatch(
      /UPDATE "MaintenanceTask"\s+SET "createdOn" = "createdAt"::date\s+WHERE "createdOn" IS NULL/,
    )
  })

  it('不以 migration 執行日或 startOn 捏造建立當地日', () => {
    expect(sql()).not.toMatch(/SET "createdOn" = (CURRENT_DATE|CURRENT_TIMESTAMP|now\(\)|"startOn")/i)
  })
})
