#!/usr/bin/env node

import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/
const EXECUTED_TEST_STATUSES = new Set(['passed', 'failed'])
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

function vitestRunResult(report, root) {
  const parsed = JSON.parse(readFileSync(report, 'utf8'))
  if (
    typeof parsed !== 'object'
    || parsed === null
    || Array.isArray(parsed)
    || !Number.isInteger(parsed.numTotalTests)
    || parsed.numTotalTests < 0
    || !Array.isArray(parsed.testResults)
    || parsed.testResults.some(result => (
      typeof result?.name !== 'string' || !Array.isArray(result?.assertionResults)
    ))
  ) {
    throw new TypeError('報告必須是含 numTotalTests 與 testResults 的 Vitest JSON reporter result')
  }

  const executedResults = parsed.testResults.map(({ name, assertionResults }) => ({
    name,
    assertions: assertionResults.filter(assertion => EXECUTED_TEST_STATUSES.has(assertion?.status)),
  }))
  const executedTests = executedResults.reduce((total, result) => total + result.assertions.length, 0)

  const files = [...new Set(executedResults.flatMap(({ name, assertions }) => {
    if (assertions.length === 0) return []

    const absolute = realpathSync(isAbsolute(name) ? name : resolve(root, name))
    const path = relative(root, absolute).split(sep).join('/')
    return path.startsWith('tests/unit/') && TEST_FILE_PATTERN.test(path) ? [path] : []
  }))].sort()

  return { executedTests, files }
}

function fail(message, details = []) {
  console.error(`::error::${message}`)
  for (const detail of details) console.error(`  - ${detail}`)
  process.exitCode = 1
}

const report = process.argv[2]
if (!report) {
  fail('用法：assert-vitest-discovery.mjs <vitest run JSON reporter result>')
}
else {
  try {
    const root = realpathSync(process.cwd())
    assertPackageScripts(root)
    const expected = unitTestFiles(resolve(root, 'tests/unit'), root)
    const result = vitestRunResult(resolve(root, report), root)

    if (result.executedTests === 0) {
      fail('Vitest 實際執行收到 0 個測試案例，必須大於 0')
    }
    else if (expected.length === 0) {
      fail('tests/unit 中沒有任何 unit test files')
    }
    else {
      const discoveredSet = new Set(result.files)
      const missing = expected.filter(file => !discoveredSet.has(file))

      if (missing.length > 0) {
        fail(`Vitest 未收錄 ${missing.length} 支 unit test files`, missing)
      }
      else {
        console.log(
          `Vitest 實際執行 ${result.executedTests} 個測試案例，涵蓋全部 ${expected.length} 支 unit test files`,
        )
      }
    }
  }
  catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
}
