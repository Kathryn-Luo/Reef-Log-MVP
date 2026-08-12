// 受保護的頁面 ↔ 「這一頁自己真的畫出來了」的正面標記（issue #146）。
//
// ── 為什麼要有這張表 ──
//
// auth-guard.spec.ts 的「已登入開 <path> 停在原地」原本只驗兩件事：網址沒被改掉、
// 登入頁的標記不存在。後者是「某個東西不存在」，而 #84 關掉 SSR 之後，
// `page.goto()` 回來時整個 app 還沒 mount——畫面上什麼都沒有，包括登入頁的標記。
// 那句斷言因此在「頁面正常載入」與「頁面根本還沒開始畫」兩種情況下都成立，
// 某一頁在登入狀態下整頁壞掉（500、或一個 render 期的例外）時照樣是綠的。
// #110 讓它更容易空過：首頁改成先畫骨架，`toHaveURL()` 一通過就可能落在
// 「什麼都還沒有」的那一瞬間。
//
// 修法與 #129 一樣：**等的必須是正面訊號**。每一頁指名一個「載入成功之後才存在」的
// data-testid，先等它出現，再驗網址與「沒有被導去登入頁」。
//
// ── 為什麼放在這裡而不是寫在 spec 裡 ──
//
// 這張表同時被兩邊讀：
//   tests/e2e/auth-guard.spec.ts                    → 真的去等這些標記（Playwright）
//   tests/unit/pages/protected-page-markers.test.ts → 證明「該頁 500 時這些標記不會出現」（Vitest）
//
// 後者是這張 issue 的重點：E2E 不在 TDD Develop 的 job 內執行（#23），所以「新寫法在
// 壞掉時真的會紅」要有地方證明。兩邊各抄一份的話，改了 spec 卻沒改證明（或反過來）
// 不會有任何東西轉紅，這張表就白訂了。
//
// 因此本檔**不 import 任何東西**——`@playwright/test` 進不了 Vitest 的執行環境。

export interface ProtectedPage {
  /** 受保護的路徑 */
  path: string
  /**
   * 這一頁「載入成功、內容真的畫出來」之後才存在的 data-testid。
   *
   * ⚠ 兩種東西不能挑：
   *   - 三態共用的常駐頁首（例如 `trends-subtitle`、`maintenance-subtitle`）在
   *     LoadErrorState 那一態同樣看得到，整頁壞掉時它還在，等於沒驗到。
   *   - 載入樣態（`*-loading`）在「還沒開始畫」與「已經畫完」時都不在畫面上，
   *     等它出現或消失都是 #129 那個假閘門的翻版。
   *
   * 兩條規則由 tests/unit/e2e/auth-guard-spec.test.ts 守著，
   * 「壞掉時真的會消失」則由 tests/unit/pages/protected-page-markers.test.ts 逐頁證明。
   */
  marker: string
}

export const PROTECTED_PAGES: readonly ProtectedPage[] = [
  // 固定頁首（缸名列 + 水質摘要）。有缸的成功態才有，載入中與載入失敗都沒有
  { path: '/', marker: 'home-sticky-header' },
  // 輸入表單本身。water-log.spec.ts 等的也是它（#124 那一輪踩過同一個坑）
  { path: '/log', marker: 'water-log-form' },
  // 六個測項 tab。trends.spec.ts 的 expectLoaded 等的就是這一個
  { path: '/trends', marker: 'parameter-tab' },
  // 頁首的「<缸名> · N 隻」副標。它整段住在「有缸」那一支 v-else 裡，
  // 與 /trends、/maintenance 那兩個常駐頁首不同——載入失敗時不會渲染
  { path: '/creatures', marker: 'inventory-subtitle' },
  // 新增頁會先取得缸清單；成功且有缸時才畫出表單
  { path: '/creatures/new', marker: 'creature-profile-form' },
  // 「今天該做」那一區。maintenance.spec.ts 的 expectLoaded 等的就是這一個。
  //
  // 它依賴「沙盒裡至少有一個任務落在兩區之內」：示範資料有五個週期性任務，
  // 隨著上次 seed 的日子過去只會愈來愈逾期（＝落進「今天該做」），所以前提站得住。
  // 真的有一天連一個任務都排不進來，這條會以「找不到 today-section」失敗——
  // 那時要修的是示範資料，不是退回只驗網址。
  { path: '/maintenance', marker: 'today-section' },
  // 新增保養任務會先讀取缸清單；成功且有缸時才畫出共用表單
  { path: '/maintenance/tasks/new', marker: 'maintenance-task-form' },
  // 靜態表單，沒有任何 GET。頁面渲染得出來就有它
  { path: '/tanks/new', marker: 'tank-form' },
  // 帳號資料成功載入後才畫出來；載入失敗會改畫 LoadErrorState
  { path: '/profile', marker: 'profile-account' },
]
