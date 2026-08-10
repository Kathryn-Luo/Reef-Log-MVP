// @vitest-environment node
// 純文字比對，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const workflows = [
  '.github/workflows/epic-breakdown.yml',
  '.github/workflows/tdd-develop.yml',
]

function expectStaleRunGuidance(text: string) {
  expect(text).toContain('workflow 定義在 run 建立當下就固定')
  expect(text).toContain('取消舊 run')
}

describe('等待核准的舊 workflow run 指引', () => {
  // Given run 在 .github/workflows/ 變更前建立、之後才被核准
  // When  使用者查閱 CLAUDE.md
  // Then  知道要比對 run commit SHA 與 main head，不一致就取消並重做觸發動作
  it('CLAUDE.md 在人工閘門章節後說明辨識與處理方式', () => {
    const guide = read('CLAUDE.md')
    const humanGate = guide.indexOf('### 只有真人做得到的兩件事')
    const staleRun = guide.indexOf('### 核准前先確認 workflow run 不是舊版')

    expect(humanGate).toBeGreaterThan(-1)
    expect(staleRun).toBeGreaterThan(humanGate)
    const guidance = guide.slice(staleRun)
    expectStaleRunGuidance(guidance)
    expect(guidance).toContain('`issues`')
    expect(guidance).toContain('commit SHA')
    expect(guidance).toContain('main')
    expect(guidance).toContain('重貼 label')
    expect(guidance).toContain('`pull_request_review`')
    expect(guidance).toContain('PR 分支')
    expect(guidance).toContain('run 建立時間')
    expect(guidance).toContain('schema-design.yml')
    expect(guidance).toContain('重送 Request changes')
  })

  // Given 三支 workflow 的檔頭註解
  // When  閱讀任何一支
  // Then  不必先讀 CLAUDE.md，也能看到同一個核准提醒
  it.each(workflows)('%s 的檔頭包含舊 run 提醒', (path) => {
    const source = read(path)
    const header = source.slice(0, source.indexOf('\non:'))

    expectStaleRunGuidance(header)
    expect(header).toContain('commit SHA')
    expect(header).toContain('main head')
    expect(header).toContain('重貼 label')
  })

  it('schema-design.yml 的檔頭分別說明 label 與 review 觸發的判斷方式', () => {
    const source = read('.github/workflows/schema-design.yml')
    const header = source.slice(0, source.indexOf('\non:'))

    expectStaleRunGuidance(header)
    expect(header).toContain('issues')
    expect(header).toContain('commit SHA')
    expect(header).toContain('main head')
    expect(header).toContain('pull_request_review')
    expect(header).toContain('run 建立時間')
    expect(header).toContain('schema-design.yml')
    expect(header).toContain('重送 Request changes')
  })
})
