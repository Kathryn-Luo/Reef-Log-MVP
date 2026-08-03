// 一次請求的分段計時（issue #98 的方向 A「先量再改」）。
//
// preview 上按下「以訪客身分瀏覽」之後，`/auth/guest` 這一次請求本身要 9.4～14.8 秒
// （實測 5 次，不是偶發冷啟）。訪客登入是這個作品集唯一對外的進站路徑，第一印象就是
// 那十幾秒——但「時間花在哪裡」目前有三個互相排斥的猜測，而且沒有任何數據分得開：
//
//   交易本身太重       → 對策是減少往返（方向 B）或縮小模板（方向 C）
//   Neon 連線建立慢    → 上面兩個都白改
//   Vercel 冷啟        → 上面三個都白改
//
// 所以這一輪只做一件事：把那條路徑切開，各段各自量。這裡刻意不含任何門檻判斷、
// 不做取樣、也不接任何外部服務——量完就寫進 log 與回應標頭，數據由人類讀。
//
// 時鐘由呼叫端注入，unit test 才能用可控的假時鐘驗（真的去睡幾毫秒既慢又會偶發失敗）。

/** 單調遞增的毫秒時鐘。`Date.now()` 會被系統校時往回撥，量時距不能用它。 */
const defaultNow = () => performance.now()

export interface TimingSegment {
  name: string
  ms: number
}

export interface Timer {
  /** 量一段：原樣回傳 `run` 的結果，`run` 拋錯時仍記下耗時再把錯誤往外拋 */
  measure: <T>(name: string, run: () => Promise<T>) => Promise<T>
  /** 目前量到的段落（複本），依「開始」的順序排列 */
  segments: () => TimingSegment[]
  /** 建立到現在的總耗時。刻意不是各段落相加——中間沒被量到的空檔也要看得見 */
  totalMs: () => number
}

/**
 * 開一個計時器，通常一個請求一個。
 *
 * 段落依「開始」的順序排，所以巢狀的父段落會排在自己的子段落前面
 * （`tx` → `tx.user` → `tx.sandbox`）。依「結束」的順序排的話父段落會沉到底，
 * log 讀起來就得反著推。
 */
export function createTimer(now: () => number = defaultNow): Timer {
  const startedAt = now()
  const segments: TimingSegment[] = []

  return {
    async measure(name, run) {
      // 先佔位再量：位置固定在「開始」的時間點上，結束時只回填數字
      const segment: TimingSegment = { name, ms: 0 }

      segments.push(segment)

      const from = now()

      try {
        return await run()
      }
      finally {
        // finally 而不是只在成功時回填：最需要數據的正是失敗那一次
        // （交易逾時、連不上 Neon），少了它 log 裡只剩一個沒有上下文的錯誤。
        segment.ms = Math.round(now() - from)
      }
    },

    // 回傳複本：格式化與 log 不該有辦法改到計時器自己記的東西
    segments: () => segments.map(segment => ({ ...segment })),

    totalMs: () => Math.round(now() - startedAt),
  }
}

export interface InstanceSnapshot {
  /** 這個 instance 是不是第一次服務請求——在 Vercel 上等同「這次是冷啟」 */
  cold: boolean
  /** 模組載入當下 process 已經跑了多久：Node 開機與載入 bundle 的那一段 */
  bootMs: number
  /** 模組載入到這次請求之間的間隔 */
  ageMs: number
}

/**
 * 「這次請求落在什麼樣的 instance 上」的探針。
 *
 * **一定要在 handler 外面建立**：建在 handler 裡的話每個請求都是自己的第一次，
 * `cold` 永遠是 true，而「Vercel 冷啟」正是這一輪要排除或坐實的猜測之一。
 *
 * 冷啟的成本大半落在模組載入之前（Node 開機、解壓 bundle、建 PrismaClient），
 * 那一段不在任何一個 `measure` 裡面，只有 process 自己的 uptime 講得出來。
 */
export function createInstanceProbe(
  now: () => number = defaultNow,
  uptimeMs: () => number = () => process.uptime() * 1000,
): () => InstanceSnapshot {
  const loadedAt = now()
  const bootMs = Math.round(uptimeMs())
  let served = 0

  return () => ({
    cold: served++ === 0,
    bootMs,
    ageMs: Math.round(now() - loadedAt),
  })
}

/**
 * 一行給人看的 log。
 *
 * 一行而不是多行：Vercel 的 runtime log 是逐行的，拆成好幾行的話同一次請求的數據
 * 會被別的請求插隊隔開。`名稱=數字ms` 這種形狀則是為了 grep 得到、也貼得進試算表。
 */
export function formatTimingLog(
  label: string,
  timer: Timer,
  instance: InstanceSnapshot,
  extra: Record<string, string | number | boolean> = {},
): string {
  const fields = [
    `total=${timer.totalMs()}ms`,
    `cold=${instance.cold}`,
    `boot=${instance.bootMs}ms`,
    `age=${instance.ageMs}ms`,
    ...Object.entries(extra).map(([key, value]) => `${key}=${value}`),
    ...timer.segments().map(segment => `${segment.name}=${segment.ms}ms`),
  ]

  return `${label} ${fields.join(' ')}`
}

/**
 * 同一份數據的 `Server-Timing` 版本。
 *
 * 為什麼要回到回應上：#95 量那五次用的是 Playwright，而 Vercel 的 runtime log 要進
 * console 才翻得到。放在標頭上的話，量一次的成本就跟按一次按鈕一樣低——瀏覽器 devtools
 * 的 Network 面板也直接讀得到。
 *
 * 這是診斷用的，方向 B / C / D 落地之後可以拿掉。它露出的是幾個毫秒數，
 * 沒有使用者資料，而 `/auth/guest` 本來就是公開路徑。
 */
export function formatServerTiming(timer: Timer, instance: InstanceSnapshot): string {
  return [
    `total;dur=${timer.totalMs()}`,
    `boot;dur=${instance.bootMs}`,
    `instance;dur=${instance.ageMs};desc="${instance.cold ? 'cold' : 'warm'}"`,
    ...timer.segments().map(segment => `${segment.name};dur=${segment.ms}`),
  ].join(', ')
}
