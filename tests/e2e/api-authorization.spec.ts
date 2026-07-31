import { expect, test } from '@playwright/test'
import type { APIRequestContext, Browser, BrowserContext } from '@playwright/test'

// 資料歸屬的伺服器邊界（issue #68）。E2E 不在 TDD Develop 的 job 內執行，
// 跑在 Vercel preview URL 上。
//
// 為什麼一定要有這一層：unit 測試驗的是 server/utils/authorization.ts 這支純函式，
// 以及「六支 handler 有沒有接上它」（讀原始碼）。真正走一遍 HTTP、帶著真的密封 cookie、
// 打真的資料庫的，只有這裡。issue 的 Story 講的就是「有人手動改網址或直接打 API」——
// 那條路徑本身要被走過一次，不能只有它的零件被驗過。
//
// 兩位使用者從訪客沙盒（#66）來：那是 preview 上唯一走得通的登入方式
// （Google 的 Authorized redirect URI 不支援萬用字元，而 preview 每個分支一個動態網址，
// 見 Epic #47 的硬約束）。每位訪客一個獨立沙盒，剛好就是 Story 要的「A 與 B」。
//
// 前提：preview 的資料庫已跑過 `prisma/seed.ts`，模板使用者名下有示範資料——
// 沒有的話沙盒是空的，下面每一題都會在 beforeAll 的 expect 上先停下來說明原因。

interface Sandbox {
  context: BrowserContext
  request: APIRequestContext
  tankId: string
  creatureId: string
  /** 缸名與生物名——用來確認「被拒絕的回應裡沒有這個人的資料」，見下方 expectNoLeak */
  tankName: string
  creatureName: string
}

/** 開一個新的瀏覽器 context，走一遍訪客登入，回傳它自己那份沙盒裡的第一個缸與第一隻生物 */
async function openSandbox(browser: Browser): Promise<Sandbox> {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto('/login')
  await page.getByTestId('login-action-guest').click()
  await expect(page).toHaveURL('/')

  const { tanks } = await (await context.request.get('/api/tanks')).json() as { tanks: { id: string, name: string }[] }

  expect(tanks.length, '訪客沙盒裡沒有任何缸——preview 的資料庫可能沒跑過 pnpm db:seed').toBeGreaterThan(0)

  const tank = tanks[0]!
  const { creatures } = await (await context.request.get(`/api/tanks/${tank.id}/creatures`))
    .json() as { creatures: { id: string, name: string }[] }

  expect(creatures.length, '訪客沙盒的缸裡沒有任何生物——preview 的示範資料可能不完整').toBeGreaterThan(0)

  const creature = creatures[0]!

  return {
    context,
    request: context.request,
    tankId: tank.id,
    creatureId: creature.id,
    tankName: tank.name,
    creatureName: creature.name,
  }
}

/**
 * 「這個 404 沒有把別人的資料送出來」。
 *
 * 刻意**不**斷言「回應體不含那個 id」：被要求的 id 會出現在錯誤回應的 `url` 欄位裡
 * （h3 把請求網址原樣回聲，production 也一樣，只有 `stack` 會被拿掉）。
 * 那不是洩漏——那個 id 是發出請求的人自己打進網址的，回聲給他不會讓他知道任何新的事。
 *
 * 真正該擋的是「這個 id 背後是什麼」：缸名、生物名、缸裡的內容。
 *
 * ⚠ 光比對名稱不夠：訪客沙盒是同一份模板複製出來的（#66），A 與 B 的缸名、生物名
 * 完全一樣，比對它等於在問「回應裡有沒有出現『主缸』」，分不出那是誰的。所以主力是
 * 下面那圈**欄位**檢查——被拒絕的回應只該有 h3 的錯誤信封，一個承載資料的欄位都不該有。
 * 名稱比對留著，是為了日後沙盒不再是複本時仍然守得住。
 *
 * 最後把 `data.message` 釘在既有常數上（server/utils/authorization.ts 的
 * TANK_NOT_FOUND / CREATURE_NOT_FOUND）——「不存在」與「不屬於你」必須一模一樣。
 */
async function expectNoLeak(
  response: Awaited<ReturnType<APIRequestContext['get']>>,
  expectedMessage: string,
  secrets: string[],
) {
  expect(response.status()).toBe(404)

  const body = await response.text()

  for (const secret of secrets) {
    expect(body, `404 的回應體不該出現「${secret}」`).not.toContain(secret)
  }

  const parsed = JSON.parse(body) as Record<string, unknown> & { data?: { message?: string } }

  for (const field of ['tank', 'tanks', 'creature', 'creatures', 'waterLogs', 'name']) {
    expect(parsed, `404 的回應體不該帶著 ${field} 欄位`).not.toHaveProperty(field)
  }

  expect(parsed.data?.message).toBe(expectedMessage)
}

test.describe('別人的 id', () => {
  let a: Sandbox
  let b: Sandbox

  test.beforeAll(async ({ browser }) => {
    // 依序開，不並行：兩位訪客同時建沙盒是 #66 自己的題目，這裡要的只是「兩個不同的人」
    a = await openSandbox(browser)
    b = await openSandbox(browser)

    expect(a.tankId).not.toBe(b.tankId)
  })

  test.afterAll(async () => {
    await Promise.all([a.context.close(), b.context.close()])
  })

  // Given 我以 A 帳號登入、B 有一個缸
  // When  我對 GET /api/tanks/<B 的 tankId>/home 發出請求
  // Then  回傳 404，不含 B 的任何資料
  test('A 打 B 的 tankId /home 得到 404，回應裡沒有 B 的資料', async () => {
    const response = await a.request.get(`/api/tanks/${b.tankId}/home`)

    // 「狀態碼是 404」與「什麼都沒送出來」是兩件事——錯誤回應的內容也要看過
    await expectNoLeak(response, '找不到這個缸。', [b.tankName, b.creatureName])
  })

  // Given 我以 A 帳號登入
  // When  我對 GET /api/tanks/<B 的 tankId>/creatures 發出請求 / Then 回傳 404
  test('A 打 B 的 tankId /creatures 得到 404', async () => {
    const response = await a.request.get(`/api/tanks/${b.tankId}/creatures`)

    await expectNoLeak(response, '找不到這個缸。', [b.tankName, b.creatureName])
  })

  // Given 我以 A 帳號登入
  // When  我對 GET /api/creatures/<B 的 creatureId> 發出請求 / Then 回傳 404
  test('A 打 B 的 creatureId 得到 404', async () => {
    const response = await a.request.get(`/api/creatures/${b.creatureId}`)

    await expectNoLeak(response, '找不到這隻生物。', [b.creatureName])
  })

  // Given 我以 A 帳號登入
  // When  我對 PATCH /api/creatures/<B 的 creatureId> 發出請求
  // Then  回傳 404
  // And   B 的那隻生物完全沒有被修改
  test('A 改不動 B 的生物，B 那一隻一個欄位都沒變', async () => {
    const before = await (await b.request.get(`/api/creatures/${b.creatureId}`)).json()

    const response = await a.request.patch(`/api/creatures/${b.creatureId}`, {
      data: {
        status: 'DEAD',
        diedOn: '2026-07-01',
        causeOfDeath: 'JUMPED',
        deathNote: '這一行不該出現在 B 的資料裡',
      },
    })

    expect(response.status()).toBe(404)

    // 由 B 自己再查一次：A 收到 404 但東西已經寫進去了，是這條路徑最糟的失敗方式
    const after = await (await b.request.get(`/api/creatures/${b.creatureId}`)).json()

    expect(after).toEqual(before)
  })

  // Given 我以 A 帳號登入
  // When  我對 GET /api/tanks 發出請求
  // Then  只回傳 A 名下未封存的缸，清單裡沒有 B 的任何缸
  test('A 的缸清單裡沒有 B 的任何缸', async () => {
    const { tanks } = await (await a.request.get('/api/tanks')).json() as { tanks: { id: string }[] }

    expect(tanks.map(tank => tank.id)).not.toContain(b.tankId)
  })

  // Given 我以 A 帳號登入
  // When  我對 POST /api/tanks 建立一個缸
  // Then  新缸的 userId 是 A，而不是資料表中最早建立的那一位
  //
  // userId 不在 API 的回應裡（頁首用不到），從外部看得出來的形式就是
  // 「它出現在 A 的清單裡，而且沒有出現在 B 的清單裡」。
  test('A 建的缸進了 A 的清單，沒有進 B 的清單', async () => {
    const created = await a.request.post('/api/tanks', { data: { name: 'A 自己建的缸' } })

    expect(created.ok()).toBe(true)

    const { tank } = await created.json() as { tank: { id: string } }

    const mine = await (await a.request.get('/api/tanks')).json() as { tanks: { id: string }[] }
    const theirs = await (await b.request.get('/api/tanks')).json() as { tanks: { id: string }[] }

    expect(mine.tanks.map(row => row.id)).toContain(tank.id)
    expect(theirs.tanks.map(row => row.id)).not.toContain(tank.id)
  })

  // Given 某個 id 根本不存在
  // When  我發出請求
  // Then  回傳的狀態碼與「存在但不屬於我」完全相同
  //       （分開回答等於告訴對方這個 id 存在）
  test('不存在的 id 與 B 的 id 得到同一個狀態碼', async () => {
    const pairs = [
      [`/api/tanks/${b.tankId}/home`, '/api/tanks/tank-does-not-exist/home'],
      [`/api/tanks/${b.tankId}/creatures`, '/api/tanks/tank-does-not-exist/creatures'],
      [`/api/creatures/${b.creatureId}`, '/api/creatures/creature-does-not-exist'],
    ]

    for (const [others, missing] of pairs) {
      const othersStatus = (await a.request.get(others!)).status()
      const missingStatus = (await a.request.get(missing!)).status()

      expect(missingStatus, `${missing} 與 ${others} 的狀態碼必須一致`).toBe(othersStatus)
    }
  })
})

// Given 我沒有登入
// When  我對上述任何一支 API 發出請求
// Then  回傳 401，不回傳任何資料
test.describe('未登入', () => {
  // 全新的 context，一張 cookie 都沒有——不是「過期」，是從來沒登入過
  test('六支 API 一律回 401', async ({ browser }) => {
    const context = await browser.newContext()

    const responses = await Promise.all([
      context.request.get('/api/tanks'),
      context.request.post('/api/tanks', { data: { name: '沒登入也想建缸' } }),
      context.request.get('/api/tanks/any-tank-id/home'),
      context.request.get('/api/tanks/any-tank-id/creatures'),
      context.request.get('/api/creatures/any-creature-id'),
      context.request.patch('/api/creatures/any-creature-id', { data: { status: 'ALIVE' } }),
    ])

    expect(responses.map(response => response.status())).toEqual([401, 401, 401, 401, 401, 401])

    await context.close()
  })

  // And POST /api/tanks 的訊息是「未登入」，不再是「請先建立使用者資料（pnpm db:seed）」
  test('POST /api/tanks 說的是「未登入」，不是叫人去跑 seed', async ({ browser }) => {
    const context = await browser.newContext()
    const response = await context.request.post('/api/tanks', { data: { name: '沒登入也想建缸' } })

    expect(response.status()).toBe(401)

    // 可以直接顯示的中文在 data.message（statusMessage 過不了 h3 的 ASCII 過濾）
    const body = await response.json() as { data?: { message?: string } }

    expect(body.data?.message).toContain('未登入')
    expect(body.data?.message).not.toContain('seed')

    await context.close()
  })

  // 兩支寫入 API 的 body 由 h3 的 readBody 解析，畸形 JSON 會讓它直接 throw 400。
  // 那一步若跑在身分檢查之前，完全沒登入的人就會拿到「Bad Request」而不是 401——
  // 狀態碼是這條邊界對外唯一的說法，401 不能被任何前置檢查蓋掉。
  //
  // unit 測試餵的是已經解析好的物件，走不到這一段，只有真的送一段壞掉的 JSON 才驗得到。
  test('未登入時，畸形的 JSON body 仍然回 401，不是 400', async ({ browser }) => {
    const context = await browser.newContext()
    const malformed = { data: '{"name":', headers: { 'content-type': 'application/json' } }

    const responses = await Promise.all([
      context.request.post('/api/tanks', malformed),
      context.request.patch('/api/creatures/any-creature-id', malformed),
    ])

    expect(responses.map(response => response.status())).toEqual([401, 401])

    await context.close()
  })

  // 健康檢查不涉及使用者資料，維持公開——把它一起關掉的話，
  // 監控會在每次 session 設定出問題時跟著一起沉默。
  test('/api/health 仍然不需登入', async ({ browser }) => {
    const context = await browser.newContext()

    expect((await context.request.get('/api/health')).ok()).toBe(true)

    await context.close()
  })
})
