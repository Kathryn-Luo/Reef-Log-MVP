// @vitest-environment node
// 純文字比對，不需要 Nuxt 環境；理由見 workflows/test-environment.test.ts（issue #38）

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// 圖表套件的「接線」（issue #140）。
//
// #140 本身不畫任何畫面，它交付的是「#123 之後只要餵資料就有圖」這個前提。那個前提
// 由三件事構成，三件都沒有可注入的介面，所以照 route-guard-wiring.test.ts 的作法
// 看原始碼本文：
//
//   ① 套件裝了、而且版本是鎖死的
//   ② echarts 以 tree-shaken 的方式引入，而且渲染器是 SVG（不是 canvas）
//   ③ 全 App 只有一個地方碰得到 echarts 的 API
//
// ② 是這一支 issue 最實質的決定：canvas 畫出來的是一張點陣圖，DOM 上只有一個
// `<canvas>`，Vitest 與 Playwright 都看不到裡面有幾個點、色帶在哪、刻度寫什麼。
// #123 的驗收條件（色帶對應 7–9、X 軸有三個日期刻度、單點時不畫線）全部會退化成
// 「有一個 canvas」。所以「SVG」不是樣式偏好，是這個專案的測試能不能寫的前提，
// 值得一條會紅的斷言守著。

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

/**
 * 剝掉整行註解。
 *
 * 非剝不可，理由與 nuxt-config.test.ts 的 vercel-edge 那一條相同：這個 repo 的檔案
 * 習慣在註解裡引述自己在防的東西——plugin 的註解就寫著「`import ... from 'echarts'`
 * 會把整包拉進 bundle」。連註解一起比的話，把理由寫清楚反而會讓測試轉紅。
 *
 * 只認整行註解就夠了：要防的是「真的程式碼被漏看」，而程式碼不會藏在 `//` 後面。
 */
function code(text: string): string {
  return text
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')
}

const PLUGIN = 'app/plugins/echarts.client.ts'
const WRAPPER = 'app/components/LineChart.vue'

const packageJson = JSON.parse(read('package.json')) as {
  dependencies: Record<string, string>
}

describe('① 套件本身', () => {
  // issue #140 第 4 節第 1 點：「裝套件（pnpm add），鎖定版本寫進 package.json」。
  it('echarts 與 vue-echarts 都在 dependencies 裡', () => {
    expect(packageJson.dependencies.echarts).toBeDefined()
    expect(packageJson.dependencies['vue-echarts']).toBeDefined()
  })

  // 鎖死到 patch，不用 ^ / ~：這兩個套件畫出來的 SVG 節點本身就是斷言的對象
  // （見下面 LineChart.test.ts），一次無聲的 minor 升級就可能改掉節點結構，
  // 讓測試在沒有人改過任何一行程式碼的情況下轉紅。與 prisma 那一對同樣的理由。
  it('版本鎖死，不帶 ^ 或 ~', () => {
    expect(packageJson.dependencies.echarts).toMatch(/^\d+\.\d+\.\d+$/)
    expect(packageJson.dependencies['vue-echarts']).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('② plugin 的引入方式', () => {
  // 檔名結尾的 .client 是「只在瀏覽器跑」的開關。這個 App 是 SPA（ssr: false），
  // 頁面本來就只在瀏覽器渲染，但 plugin 若不帶 .client，Nitro 那一側也會把它打包
  // 進去——echarts 是純瀏覽器函式庫，沒有理由出現在 server bundle 裡。
  it('掛在 app/plugins/echarts.client.ts，只在瀏覽器跑', () => {
    expect(existsSync(resolve(process.cwd(), PLUGIN))).toBe(true)
    expect(read(PLUGIN)).toContain('defineNuxtPlugin')
  })

  // 只註冊這張圖用得到的模組。`import ... from 'echarts'` 會把整包（含地圖、3D、
  // gauge…）拉進 bundle，正是 issue 第 3 節列的顧慮。
  it('走 echarts/core 的 use()，不整包 import', () => {
    const source = code(read(PLUGIN))

    expect(source).toMatch(/'echarts\/core'/)
    expect(source).toMatch(/\buse\(\[/)
    // 只擋「整包」那一種寫法：'echarts/core'、'echarts/charts' 等子路徑不受影響。
    // 靜態與動態兩種寫法都要擋——差別只在打包到哪個 chunk，體積是一樣的。
    expect(source).not.toMatch(/from 'echarts'/)
    expect(source).not.toMatch(/import\('echarts'\)/)
  })

  // 動態 import 一併擋掉，理由與整包 import 相同但不那麼直覺：`import('echarts/charts')`
  // 拿的是整個模組，tree-shaking 隨之失效（bar、pie、map… 全進來）。這一版量過，改成
  // 動態 import 之後 JS 總量從 989 KB 漲到 1.6 MB——寫的人以為自己在省，實際上是在加。
  it('用具名的靜態 import，不用動態 import 整個子模組', () => {
    const source = code(read(PLUGIN))

    expect(source).toMatch(/^import \{[^}]*\bLineChart\b[^}]*\} from 'echarts\/charts'/m)
    expect(source).not.toMatch(/import\('echarts/)
  })

  // 這一條是整支 issue 的分水嶺，理由見檔案開頭。
  it('渲染器是 SVGRenderer，沒有 CanvasRenderer', () => {
    const source = code(read(PLUGIN))

    expect(source).toContain('SVGRenderer')
    expect(source).not.toContain('CanvasRenderer')
  })

  // 色帶（markArea）與座標系（grid）是 #123 的驗收條件直接用得到的兩個模組。
  // 忘了註冊的話 echarts 不會報錯，只會安靜地不畫——正是最難查的那種失敗。
  it('註冊了折線、座標系與色帶模組', () => {
    const source = read(PLUGIN)

    expect(source).toContain('LineChart')
    expect(source).toContain('GridComponent')
    expect(source).toContain('MarkAreaComponent')
  })

  it('把元件註冊成全域的 VChart', () => {
    expect(read(PLUGIN)).toMatch(/vueApp\.component\(\s*'VChart'/)
  })
})

describe('③ 只有一個地方碰 echarts 的 API', () => {
  /** app/ 底下所有的 .vue 與 .ts */
  function appSources(dir = 'app'): string[] {
    return readdirSync(resolve(process.cwd(), dir)).flatMap((name) => {
      const relative = join(dir, name)

      if (statSync(resolve(process.cwd(), relative)).isDirectory()) {
        return appSources(relative)
      }

      return /\.(vue|ts)$/.test(name) ? [relative] : []
    })
  }

  // issue #140 第 4 節第 3 點：「#123 只餵資料不碰套件 API」。
  //
  // 這一條是本輪唯一擋得住「下一支 issue 又在頁面裡自己 import echarts、自己拼一份
  // option」的地方。散落之後，換套件、改配色、修時間軸格式都要一頁一頁追，而
  // 「資料 → 選項物件」收斂在一個地方正是這支包裝元件存在的理由。
  it('除了 plugin 與 LineChart.vue，app/ 底下沒有人碰 echarts', () => {
    const allowed = new Set([PLUGIN, WRAPPER])
    const offenders = appSources()
      .filter(file => !allowed.has(file))
      .filter(file => /\becharts\b|\bVChart\b/i.test(read(file)))

    expect(offenders).toEqual([])
  })

  it('包裝元件在 app/components/LineChart.vue', () => {
    expect(existsSync(resolve(process.cwd(), WRAPPER))).toBe(true)
  })
})
