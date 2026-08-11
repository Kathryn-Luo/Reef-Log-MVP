// @vitest-environment node

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const pagesDirectory = fileURLToPath(new URL('../../../app/pages/creatures/', import.meta.url))

describe('生物詳情與編輯的檔案路由', () => {
  it('詳情使用 [id]/index.vue，讓 /creatures/:id/edit 成為可獨立渲染的同層路由', () => {
    expect(existsSync(`${pagesDirectory}[id]/index.vue`)).toBe(true)
    expect(existsSync(`${pagesDirectory}[id].vue`)).toBe(false)
  })
})
