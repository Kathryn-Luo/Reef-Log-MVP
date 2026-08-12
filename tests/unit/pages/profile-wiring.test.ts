// @vitest-environment node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'app/pages/profile.vue'), 'utf8')

describe('/profile 載入流程', () => {
  it('非阻塞地啟動個人資料請求，讓初次載入骨架能立即渲染', () => {
    expect(source).toMatch(/useAsyncData\(\s*'profile'/)
    expect(source).not.toMatch(/await\s+useAsyncData\(\s*'profile'/)
    expect(source).toContain('{ lazy: true }')
    expect(source).toContain('data-testid="profile-loading"')
  })
})
