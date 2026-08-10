#!/usr/bin/env node

import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/
const EXPECTED_PACKAGE_SCRIPTS = {
  test: 'vitest run',
  lint: 'eslint .',
  typecheck: 'nuxt typecheck',
}

function assertPackageScripts(root) {
  const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

  for (const [name, expected] of Object.entries(EXPECTED_PACKAGE_SCRIPTS)) {
    const actual = packageJson.scripts?.[name]
    if (actual !== expected) {
      throw new Error(
        `package.json 的 scripts.${name} 必須是 ${JSON.stringify(expected)}，目前是 ${JSON.stringify(actual)}`,
      )
    }
  }
}

function unitTestFiles(directory, root) {
  const files = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...unitTestFiles(path, root))
    }
    else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
      files.push(relative(root, path).split(sep).join('/'))
    }
  }

  return files.sort()
}

function unitTestFilesWithCases(report, root) {
  const parsed = JSON.parse(readFileSync(report, 'utf8'))
  if (!Array.isArray(parsed) || parsed.some(entry => (
    typeof entry?.name !== 'string' || typeof entry?.file !== 'string'
  ))) {
    throw new TypeError('Vitest discovery report 必須是含 name 與 file 欄位的實際 test cases 陣列')
  }

  return [...new Set(parsed.flatMap(({ file }) => {
    const absolute = realpathSync(isAbsolute(file) ? file : resolve(root, file))
    const path = relative(root, absolute).split(sep).join('/')
    return path.startsWith('tests/unit/') && TEST_FILE_PATTERN.test(path) ? [path] : []
  }))].sort()
}

function fail(message, details = []) {
  console.error(`::error::${message}`)
  for (const detail of details) console.error(`  - ${detail}`)
  process.exitCode = 1
}

const report = process.argv[2]
if (!report) {
  fail('用法：assert-vitest-discovery.mjs <vitest discovery JSON>')
}
else {
  try {
    const root = realpathSync(process.cwd())
    assertPackageScripts(root)
    const expected = unitTestFiles(resolve(root, 'tests/unit'), root)
    const discovered = unitTestFilesWithCases(resolve(root, report), root)

    if (expected.length === 0) {
      fail('tests/unit 中沒有任何 unit test files')
    }
    else {
      const discoveredSet = new Set(discovered)
      const missing = expected.filter(file => !discoveredSet.has(file))

      if (missing.length > 0) {
        fail(`Vitest 未收錄 ${missing.length} 支 unit test files`, missing)
      }
      else {
        console.log(`Vitest 已收錄全部 ${expected.length} 支 unit test files`)
      }
    }
  }
  catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
}
