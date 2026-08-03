import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect } from 'vitest'

// E2E spec 的「原始碼本文」比對工具（issue #87 起用，issue #95 抽出共用）。
//
// 為什麼要對 spec 的文字做斷言：這些 spec 要驗的東西只有 E2E 跑得出來（要真的有瀏覽器、
// 真的有 preview 環境），而 E2E 不在 TDD Develop 的 job 內執行。所以 unit 這一側守的是
// 「修法有沒有走偏」——擋得住整段被拿掉或換掉，擋不住細節寫錯；後者由 Vercel preview
// 上的 `pnpm test:e2e` 收尾。

export const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

/**
 * 把一支 spec 切成「一個 test 一段」。
 *
 * 切在每一行開頭的 `test(` / `test.describe(` 之前，所以 describe 的標頭與它的
 * `beforeEach` 會落在同一段——那正好是我們要的：`beforeEach` 裡的登入步驟屬於
 * 它底下每一條 test。
 */
export function testBlocks(source: string): string[] {
  return source.split(/\n(?=[ \t]*test(?:\.\w+)?\()/)
}

/** 取出標題含 `title` 的那一段 */
export function blockOf(file: string, title: string): string {
  const block = testBlocks(read(file)).find(candidate => candidate.includes(title))

  expect(block, `${file} 找不到「${title}」這條 test`).toBeDefined()

  return block!
}
