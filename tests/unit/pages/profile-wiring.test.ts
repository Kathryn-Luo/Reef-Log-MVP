// @vitest-environment node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'app/pages/profile.vue'), 'utf8')

describe('/profile 載入流程', () => {
  it('非阻塞地啟動個人資料請求，讓初次載入骨架能立即渲染', () => {
    expect(source).toContain('useAsyncData(\'profile\'')
    expect(source).not.toContain('await useAsyncData(\'profile\'')
    expect(source).toContain('data-testid="profile-loading"')
  })
})
