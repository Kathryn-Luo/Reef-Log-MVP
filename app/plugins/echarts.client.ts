import { LineChart } from 'echarts/charts'
import { GridComponent, MarkAreaComponent } from 'echarts/components'
import { use } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'

// 圖表套件的註冊（issue #140）。
//
// 為什麼是 plugin：`use()` 是一次性的全域註冊，放在元件裡會跟著元件被掛載幾次就跑
// 幾次。這裡是全 App 唯一決定「載入了哪些 echarts 模組」的地方。
//
// ── 為什麼是 SVG renderer（這支 issue 最實質的決定）──
//
// echarts 預設用 canvas，畫出來是一張點陣圖：DOM 上只有一個 `<canvas>`，Vitest 與
// Playwright 都看不到裡面有幾個資料點、色帶在哪、刻度寫什麼。本專案 TDD 強制，而
// #123 的驗收條件講的正是圖本身（色帶對應 KH 的 7–9、X 軸的日期刻度、單一資料點時
// 不畫出一條假的線）——canvas 之下那些只能退化成「有一個 canvas」，或是在 CI 上比
// 視覺快照。SVG 畫出來的是真的 DOM 節點，那些條件照常寫得出來。
//
// ── 為什麼一個一個 import ──
//
// `import ... from 'echarts'` 會把整包（含這張圖永遠用不到的地圖、3D、gauge）拉進
// bundle。這裡只註冊四個模組，各自對應一件看得見的事：
//
//   LineChart         折線與資料點
//   GridComponent     直角座標系（X / Y 軸、格線）
//   MarkAreaComponent 正常區間的背景色帶
//   SVGRenderer       上面那件事
//
// 之後要用到別的圖（例如長條圖）就在這裡補一個，不要改成整包 import。
//
// ⚠ 已知的成本，留給 #123 或人類決定要不要處理：plugin 在 App 啟動時就會跑，所以
// 這五行靜態 import 會落在 entry chunk 裡——量過是每一頁都要先下載的 +482 KB
// （未 gzip；495 KB → 989 KB），連登入頁都算在內，而圖只出現在六個分頁裡的一個。
//
// 這一版試過改成 `defineAsyncComponent` + 動態 import 把它切成獨立 chunk，結果更差：
// 動態 import 拿的是整個 `echarts/charts` / `echarts/components` 模組，tree-shaking
// 隨之失效（bar、pie、map… 全進來），JS 總量反而從 989 KB 漲到 1.6 MB。要兩者兼得
// 得多開一支「靜態 import + use()」的模組讓 plugin 去動態載它，那是多一層檔案結構的
// 決定，超出這支 issue「裝套件、接起來」的範圍。
//
// 檔名的 .client 讓它只在瀏覽器跑。這個 App 是 SPA（ssr: false），頁面本來就只在
// 瀏覽器渲染，但少了 .client 的話 Nitro 那一側也會打包一份——echarts 是純瀏覽器
// 函式庫，沒有理由出現在 server bundle 裡（已驗證：server bundle 裡沒有 echarts）。
export default defineNuxtPlugin((nuxtApp) => {
  use([LineChart, GridComponent, MarkAreaComponent, SVGRenderer])

  // 註冊成全域元件，但只有 app/components/LineChart.vue 用得到它：
  // 「資料 → 選項物件」收斂在那一支，頁面（#123）只餵資料。
  nuxtApp.vueApp.component('VChart', VChart)
})
