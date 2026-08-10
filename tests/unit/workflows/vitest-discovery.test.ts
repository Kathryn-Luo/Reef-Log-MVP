// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const scriptPath = resolve(process.cwd(), '.github/scripts/assert-vitest-discovery.mjs')
const temporaryDirectories: string[] = []

function projectWith(testFiles: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'reef-log-vitest-discovery-'))
  temporaryDirectories.push(root)

  writeFileSync(join(root, 'package.json'), JSON.stringify({
    scripts: {
      test: 'vitest run',
      lint: 'eslint .',
      typecheck: 'nuxt typecheck',
    },
  }))

  for (const file of testFiles) {
    const path = join(root, file)
    mkdirSync(resolve(path, '..'), { recursive: true })
    writeFileSync(path, 'export {}\n')
  }

  return root
}

function writeScripts(root: string, scripts: Record<string, string>) {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts }))
}

function writeResult(root: string, files: string[]) {
  const report = join(root, 'vitest-result.json')
  writeFileSync(report, JSON.stringify({
    numTotalTests: files.length,
    success: true,
    testResults: files.map((file, index) => ({
      name: join(root, file),
      status: 'passed',
      assertionResults: [{
        fullName: `test case ${index + 1}`,
        status: 'passed',
        title: `test case ${index + 1}`,
      }],
    })),
  }))
  return report
}

function verifyReport(root: string, report: string) {
  return spawnSync(process.execPath, [scriptPath, report], {
    cwd: root,
    encoding: 'utf8',
  })
}

function verify(root: string, discoveredFiles: string[]) {
  return verifyReport(root, writeResult(root, discoveredFiles))
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Vitest 測試探索守門', () => {
  it('所有 tests/unit 測試檔都有被 Vitest 收錄時通過', () => {
    const files = [
      'tests/unit/example.test.ts',
      'tests/unit/nested/example.spec.ts',
    ]
    const root = projectWith(files)

    const result = verify(root, files)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Vitest 實際執行 2 個測試案例，涵蓋全部 2 支 unit test files')
  })

  it('Vitest 少收任何一支 unit test 時失敗並列出檔名', () => {
    const root = projectWith([
      'tests/unit/included.test.ts',
      'tests/unit/excluded.test.ts',
    ])

    const result = verify(root, ['tests/unit/included.test.ts'])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Vitest 未收錄 1 支 unit test files')
    expect(result.stderr).toContain('tests/unit/excluded.test.ts')
  })

  it('Vitest 實際執行零個 test case 時失敗', () => {
    const root = projectWith(['tests/unit/example.test.ts'])

    const result = verify(root, [])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Vitest 實際執行收到 0 個測試案例')
  })

  it('拒絕 vitest list 的陣列格式，避免驗證到另一種 invocation', () => {
    const file = 'tests/unit/example.test.ts'
    const root = projectWith([file])
    const report = join(root, 'vitest-result.json')
    writeFileSync(report, JSON.stringify([{
      name: 'test case 1',
      file: join(root, file),
    }]))

    const result = verifyReport(root, report)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Vitest JSON reporter result')
  })

  it('只有 skipped test cases 而沒有實際執行案例時失敗', () => {
    const file = 'tests/unit/example.test.ts'
    const root = projectWith([file])
    const report = join(root, 'vitest-result.json')
    writeFileSync(report, JSON.stringify({
      numTotalTests: 1,
      success: true,
      testResults: [{
        name: join(root, file),
        status: 'passed',
        assertionResults: [{ status: 'pending', title: 'skipped case' }],
      }],
    }))

    const result = verifyReport(root, report)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('實際執行收到 0 個測試案例')
  })

  it.each([
    ['test', 'vitest run definitely-no-such-test --passWithNoTests'],
    ['lint', 'eslint app'],
    ['typecheck', 'echo skipped'],
  ])('package.json 的 scripts.%s 被縮限或略過時失敗', (script, command) => {
    const files = ['tests/unit/example.test.ts']
    const root = projectWith(files)
    writeScripts(root, {
      test: 'vitest run',
      lint: 'eslint .',
      typecheck: 'nuxt typecheck',
      [script]: command,
    })

    const result = verify(root, files)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`scripts.${script}`)
  })
})
