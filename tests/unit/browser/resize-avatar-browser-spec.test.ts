// @vitest-environment node
// 純文字比對，不需要 Nuxt 環境；理由見 test-environment.test.ts（issue #38）

import { describe, expect, it } from 'vitest'
import { blockOf, read, testBlocks } from '../support/spec-source'

// issue #176：`resizeAvatar` 的真實瀏覽器覆蓋。
//
// ── 為什麼這一側只能比對原始碼本文 ──
//
// `tests/browser/` 底下那支跑在真的 Chromium 裡（真的 `createImageBitmap`、真的 canvas、
// 真的 WebP 編碼器），由 `pnpm test:browser` 執行——**不是** `pnpm test`。
// 兩者是不同的 vitest 執行，所以這一側看不到那一側的結果，情況與 `tests/e2e/` 完全同型，
// 守法也就沿用 `tests/unit/e2e/` 那一套：比對原始碼本文。
//
// 檔名刻意是 `.browser.ts` 而不是 `.browser.test.ts`：vitest 預設只收 `*.test.*` /
// `*.spec.*`，所以它天生就不會被 `pnpm test` 收進來，不必往 `vitest.config.ts` 的
// `exclude` 加東西——那份白名單是 #32 的防線（`ci-runner-config.test.ts`），
// 為了一個新目錄去放寬它，代價比檔名慣例大得多。
//
// ── 這支測試證明了什麼、沒證明什麼 ──
//
// 守得住「修法有沒有走偏」：三條 Then 各自有一條 test、驗的是真的瀏覽器 API 而不是替身、
// 量的是真的解回來的像素、沒有人為了讓它好過而把它改回 mock。
//
// 守不住「斷言本身對不對」——那由 `pnpm test:browser` 自己驗，而它在 CI 上是另一個
// 步驟。兩邊都需要：那一側證明斷言成立，這一側證明斷言還是原來要驗的那件事。

const SPEC = 'tests/browser/resize-avatar.browser.ts'
const source = read(SPEC)

/** issue #176「若採 A，測試該驗什麼」的三條 Then ↔ 對應那條 test 的標題 */
const STORIES = [
  ['①1024×768 → 長邊 512、維持 4:3、image/webp', '長邊縮到 512 px，維持 4:3，輸出是 image/webp'],
  ['②200×150 → 尺寸不變（只縮不放）', '200×150 的圖維持原尺寸，不放大'],
  ['③EXIF Orientation=6 → 方向與肉眼一致', 'EXIF Orientation=6 的照片轉正之後才縮'],
] as const

/**
 * 去掉註解再看。
 *
 * 底下幾題比對的是「有沒有用到某個 API」，而說明這件事的註解本身就會提到那些名字
 * ——不去掉的話，量到的是註解，不是程式碼。
 */
const withoutComments = (block: string) =>
  block
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')

const code = withoutComments(source)

describe('三條 Then 各有一條瀏覽器測試', () => {
  it.each(STORIES)('%s 有對應的 test', (_story, title) => {
    expect(blockOf(SPEC, title)).toBeTruthy()
  })

  it('至少三條 test，沒有兩條 Then 擠在同一條裡', () => {
    expect((source.match(/^[ \t]*test\(/gm) ?? []).length).toBeGreaterThanOrEqual(STORIES.length)
  })

  it('每一條 test 都真的呼叫 resizeAvatar', () => {
    const blocks = testBlocks(source).filter(block => /^[ \t]*test\(/m.test(block))

    expect(blocks.length).toBeGreaterThanOrEqual(STORIES.length)

    for (const block of blocks) {
      expect(withoutComments(block), '有一條 test 沒有呼叫 resizeAvatar').toContain('resizeAvatar(')
    }
  })
})

// 這整張 issue 的理由就是「#168 的 unit test 只能 mock 瀏覽器那三個 API，
// 驗到的是我呼叫了 mock、mock 回了我安排好的東西」。這一組守的是這裡不准重蹈覆轍。
describe('驗的是真的瀏覽器，不是替身', () => {
  it('受測的是 app/utils/avatarImage 本體', () => {
    expect(code).toMatch(/import\s*\{[^}]*\bresizeAvatar\b[^}]*\}\s*from\s*'\.\.\/\.\.\/app\/utils\/avatarImage'/)
  })

  it('沒有 mock、stub 或改寫任何瀏覽器 API', () => {
    for (const forbidden of [
      'vi.stubGlobal',
      'vi.fn',
      'vi.mock',
      'vi.spyOn',
      'HTMLCanvasElement.prototype',
      'globalThis.createImageBitmap =',
    ]) {
      expect(code, `瀏覽器測試不該出現 ${forbidden}`).not.toContain(forbidden)
    }
  })

  // 這三個 API 是 issue #176 的全部理由：happy-dom 一個都沒有，所以 unit 那一側只能
  // 換成替身。它們散在共用的輔助函式裡（pngFile / sizeOf / quadrantLuma），
  // 所以在整份檔案的層級驗，不是逐條 test 驗。
  it('三個只有真瀏覽器才有的 API 都真的用上了', () => {
    // 尺寸是把輸出解回點陣圖量到的，不是從呼叫參數推回來的
    expect(code, '沒有把輸出解回點陣圖').toContain('createImageBitmap(')
    // 來源的 PNG 是真的請瀏覽器編碼出來的
    expect(code, '來源不是真的畫出來的').toContain('toBlob(')
    expect(code, '來源不是 PNG').toContain('image/png')
    // 方向那一條要讀回真的像素
    expect(code, '沒有讀回像素').toContain('getImageData')
  })
})

// Then 輸出的長邊是 512、維持 4:3、型別是 image/webp
describe('①長邊 512、維持 4:3、image/webp', () => {
  const block = () => withoutComments(blockOf(SPEC, STORIES[0][1]))

  it('來源是 1024×768', () => {
    expect(block()).toMatch(/pngFile\(\s*1024,\s*768\s*\)/)
  })

  it('三件事都驗到了：長邊、比例、輸出型別', () => {
    const text = block()

    expect(text).toContain('AVATAR_MAX_EDGE')
    expect(text).toContain('384')
    expect(text).toContain('AVATAR_OUTPUT_TYPE')
  })

  it('驗的是輸出檔案自己的 type，不是傳給編碼器的參數', () => {
    expect(block()).toMatch(/\.type\)?\s*\)?\.toBe\(/)
  })
})

// Then 尺寸不變（只縮不放）
describe('②200×150 維持原尺寸', () => {
  const block = () => withoutComments(blockOf(SPEC, STORIES[1][1]))

  it('來源是 200×150', () => {
    expect(block()).toMatch(/pngFile\(\s*200,\s*150\s*\)/)
  })

  it('斷言的是原尺寸本身，不是「小於等於 512」這種放寬版', () => {
    const text = block()

    expect(text).toMatch(/toEqual\(\s*\{\s*width:\s*200,\s*height:\s*150\s*\}\s*\)/)
    expect(text).not.toMatch(/toBeLessThanOrEqual|toBeLessThan\(/)
  })
})

// Then 輸出的長寬比與肉眼看到的方向一致，不是躺著的那一版
//
// 這一條是整張 issue 最有價值的部分：EXIF 方向在畫進 canvas 之後就消失了，
// 「預覽是正的、上傳後躺著」在 mock 底下永遠測不出來。
describe('③EXIF 方向', () => {
  const block = () => withoutComments(blockOf(SPEC, STORIES[2][1]))

  it('來源是帶 Orientation tag 的 fixture，不是 canvas 畫出來的圖', () => {
    const text = block()

    expect(text).toContain('exifJpeg(')
    expect(text).toContain('EXIF_ORIENTATION_ROTATE_90_CW')
  })

  it('斷言的是直式的輸出（256×512），不是躺著的那一版', () => {
    const text = block()

    expect(text).toMatch(/toEqual\(\s*\{\s*width:\s*256,\s*height:\s*512\s*\}\s*\)/)
  })

  // 只比長寬比的話，順時針 90 度與逆時針 90 度給的是同一個答案，
  // 而那兩者在畫面上差了 180 度。所以要再讀一次像素，確認深色角落轉到了右上。
  it('再讀一次像素，確認是往順時針轉的那一邊', () => {
    const text = block()

    expect(text, '沒有讀回四個象限的亮度').toContain('quadrantLuma(')
    // 深色象限要落在右上；只驗「有一角是深的」的話，逆時針轉 90 度也會通過
    expect(text).toMatch(/expect\(\s*topRight[\s\S]{0,40}\.toBeLessThan\(/)
    expect(text).toMatch(/expect\(\s*topLeft[\s\S]{0,40}\.toBeGreaterThan\(/)
    expect(text).toMatch(/expect\(\s*bottomLeft[\s\S]{0,40}\.toBeGreaterThan\(/)
    expect(text).toMatch(/expect\(\s*bottomRight[\s\S]{0,40}\.toBeGreaterThan\(/)
  })

  // 對照組：同樣的像素、只有 Orientation 不同的那一份必須給出躺著的結果。
  // 少了它，「瀏覽器根本沒讀 EXIF」與「瀏覽器讀了而且轉對了」分不出來。
  it('有 Orientation=1 的對照組，且它的結果是橫的', () => {
    const text = block()

    expect(text).toContain('EXIF_ORIENTATION_NONE')
    expect(text).toMatch(/toEqual\(\s*\{\s*width:\s*512,\s*height:\s*256\s*\}\s*\)/)
  })
})

describe('沒有 test 被刪掉或跳過', () => {
  // 用組出來的字串而不是寫死：本檔在 tests/unit 底下，
  // test-environment.test.ts 會掃這裡的原始碼，寫死的話會掃到自己
  const FORBIDDEN = ['only', 'skip', 'skipIf', 'todo', 'runIf', 'fails'].map(name => `test.${name}(`)

  it('沒有被宣告成跳過或獨佔的 test', () => {
    expect(FORBIDDEN.filter(marker => code.includes(marker))).toEqual([])
  })
})

// Given 人類核准了 `@vitest/browser` 這個開發相依與對應的 CI 設定（issue #176）
// When  瀏覽器測試被接上
// Then  三個環節缺一不可地都在：相依、跑得起來的設定與 script、CI 真的會執行它
//
// 這一組原本反過來寫——斷言相依**沒有**被自作主張加進去，是「我沒有偷偷做掉那個
// 人類閘門」的機械證據。核准之後它的用途換了一個方向：守住「接上了就不要再掉下去」。
//
// 為什麼三項要一起驗：任何一項單獨存在都會產生一個**看起來有覆蓋、實際上沒有**的
// 狀態。裝了相依卻沒有 script，或有 script 卻沒有接進 CI，`tests/browser/` 就只是
// 一份沒有人執行的檔案——而那正是 #176 一開始要解決的問題。
describe('瀏覽器測試真的被接起來了', () => {
  const REQUIRED_PACKAGES = ['@vitest/browser', '@vitest/browser-playwright']
  const packageJson = JSON.parse(read('package.json'))
  const config = read('vitest.browser.config.ts')
  const ci = read('.github/workflows/ci.yml')
  const doc = read('docs/BROWSER_TESTS.md')

  it.each(REQUIRED_PACKAGES)('%s 在 devDependencies 裡', (name) => {
    expect(packageJson.devDependencies?.[name]).toBeTruthy()
  })

  // 相依只放 dependencies 的話，production bundle 會多背一整套測試工具
  it.each(REQUIRED_PACKAGES)('%s 沒有被放進 dependencies', (name) => {
    expect(packageJson.dependencies?.[name]).toBeUndefined()
  })

  it('有一個 test:browser script，指向獨立的那份設定', () => {
    expect(packageJson.scripts?.['test:browser']).toBe('vitest run --config vitest.browser.config.ts')
  })

  // 這份設定**不可以**去碰 vitest.config.ts 的收檔範圍：那份白名單是 #32 的防線
  // （ci-runner-config.test.ts 逐項鎖住）。兩邊獨立，`pnpm test` 收哪些檔一個字都沒動。
  it('設定只收 tests/browser/，而且跑的是真的瀏覽器', () => {
    expect(config).toContain('tests/browser/**/*.browser.ts')
    expect(config).toContain('enabled: true')
    expect(config).toContain('chromium')
  })

  // CI 少了任一步，這組測試就只是一份沒有人執行的檔案
  it('CI 會裝 Chromium，而且真的執行 pnpm test:browser', () => {
    expect(ci).toContain('playwright install --with-deps chromium')
    expect(ci).toMatch(/run:\s*pnpm test:browser/)
  })

  // 前一步失敗不該讓它被跳過——與 ci.yml 其餘四項檢查同一個規則（ci-checks.test.ts）
  it('CI 的瀏覽器測試步驟掛著 !cancelled()', () => {
    const step = ci.slice(ci.indexOf('name: Browser tests'))
    expect(step).toMatch(/if:\s*\$\{\{\s*!\s*cancelled\(\)\s*\}\}/)
  })

  it('docs 寫明了裝哪些套件，也指得到那支測試與它的設定檔', () => {
    for (const name of REQUIRED_PACKAGES) {
      expect(doc, `docs/BROWSER_TESTS.md 沒有提到 ${name}`).toContain(name)
    }

    expect(doc).toContain(SPEC)
    expect(doc).toContain('vitest.browser.config.ts')
  })
})
