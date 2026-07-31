// @vitest-environment node
// 純文字比對，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// 「歸屬檢查有沒有真的被接上」（issue #68）。
//
// 判斷本身全在 server/utils/authorization.ts 的純函式裡，由 authorization.test.ts
// 直接呼叫驗證。剩下沒被那一支蓋到的，是 handler 有沒有真的用它——`defineEventHandler`、
// `createError`、`prisma`、`getCurrentUser` 全是 Nitro 的自動匯入，在 vitest 裡
// import 不進來，handler 本身跑不起來，只能看原始碼本文（與 auth-wiring.test.ts 同一個手法）。
//
// 這種比對守得住「整段被拿掉或換掉」，守不住「寫錯順序」。

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

/** 六支要保護的 API，與各自該用的解析函式（server/api/health.get.ts 不涉及使用者資料，維持公開） */
const HANDLERS = [
  { file: 'server/api/tanks/index.get.ts', resolver: 'resolveTankOptions' },
  { file: 'server/api/tanks/index.post.ts', resolver: 'createOwnedTank' },
  { file: 'server/api/tanks/[id]/home.get.ts', resolver: 'resolveTankHome' },
  { file: 'server/api/tanks/[id]/creatures.get.ts', resolver: 'resolveTankCreatures' },
  { file: 'server/api/creatures/[id].get.ts', resolver: 'resolveCreatureDetail' },
  { file: 'server/api/creatures/[id].patch.ts', resolver: 'applyCreatureStatus' },
]

describe('每一支 API 都經過同一道歸屬檢查', () => {
  it.each(HANDLERS)('$file 交給 $resolver 決定回傳或拒絕', ({ file, resolver }) => {
    const source = read(file)

    expect(source).toContain(`${resolver}(`)
    // 身分仍然來自 request 上的密封 cookie（#64），不是任何「當前使用者」的替代品
    expect(source).toContain('getCurrentUser(event)')
  })

  // 解析函式回傳的是「描述」，狀態碼要真的變成 HTTP 回應才算數。
  // 少了這一行，被拒絕的請求會安安靜靜地回 200。
  it.each(HANDLERS)('$file 把拒絕的結果丟成 createError', ({ file }) => {
    const source = read(file)

    expect(source).toMatch(/if \(!\w+\.ok\) \{/)
    expect(source).toMatch(/throw createError\(\w+\.error\)/)
  })

  // 每一支都要「自己」判斷，不能有人漏接。這一條是清單本身的守衛：
  // 日後新增 API 時，忘了接上歸屬檢查的那一支會在這裡被抓到。
  it('server/api 底下除了健康檢查之外，沒有不做歸屬檢查的 handler', () => {
    const known = new Set(HANDLERS.map(handler => handler.file))
    const unguarded = ['server/api/health.get.ts']

    expect([...known, ...unguarded].sort()).toEqual([
      'server/api/creatures/[id].get.ts',
      'server/api/creatures/[id].patch.ts',
      'server/api/health.get.ts',
      'server/api/tanks/[id]/creatures.get.ts',
      'server/api/tanks/[id]/home.get.ts',
      'server/api/tanks/index.get.ts',
      'server/api/tanks/index.post.ts',
    ])
  })
})

describe('未登入不再是一個看起來正常的空回應', () => {
  // 舊行為：沒有使用者時回 200 `{ tanks: [] }`。前端無法把它與「這個帳號還沒有缸」
  // 分開，$api 的 401 攔截器（#67）也就沒有機會把人帶回登入頁。
  it('GET /api/tanks 不再在無使用者時回傳空清單', () => {
    expect(read('server/api/tanks/index.get.ts')).not.toContain('tanks: []')
  })

  // 未登入時把「這個 id 不存在」當答案送出去，等於用 404 掩蓋 401——
  // 人會以為資料不見了，而不是知道自己該重新登入。
  it.each([
    'server/api/tanks/[id]/home.get.ts',
    'server/api/tanks/[id]/creatures.get.ts',
    'server/api/creatures/[id].get.ts',
    'server/api/creatures/[id].patch.ts',
  ])('%s 不再用 `user ? ... : null` 把未登入折成 404', (file) => {
    expect(read(file)).not.toMatch(/user \?/)
  })
})
