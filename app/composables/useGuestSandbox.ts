import type { GuestSandboxResponse } from '#shared/types/guestSandbox'

/**
 * 訪客的示範資料還在不在路上（issue #144）。
 *
 * 為什麼要跨頁共用：複製要 11.5 秒，而使用者在那段時間**可以走動**。底部的 tab 列
 * 一直都在，切到「趨勢」或「保養」看到的若是各頁自己的「還沒有任何缸」，畫面就等於
 * 在說謊——而首頁同一時間正說著「正在為你準備」。這在 preview 上實際踩到過。
 *
 * 更嚴重的是另一半：補建原本只有首頁會觸發，所以**書籤直接開 `/log`** 的訪客
 * 永遠等不到資料——首頁沒掛載，那支 API 一次都不會被呼叫。狀態提升到這裡之後，
 * 哪一頁先拿到空清單就由哪一頁觸發，這個洞跟著補起來。
 *
 * 這裡刻意**不**去禁用底部的 tab 列：11.5 秒把整個 app 鎖住，體感比看到空狀態更像
 * 當掉，而且擋不住上面那個書籤的情況——它治的是症狀不是病。
 *
 * ── 狀態 ──
 *
 *   'unknown'   還沒問過。**空清單在這一態也算準備中**——否則從「載入完成、0 個缸」
 *               到「開始準備」之間會閃一次空狀態。
 *   'preparing' 正在複製。畫面上要有明確在跑的訊號，不是一片骨架：這一段長達十幾秒，
 *               看不出在跑的話使用者會以為當掉了。
 *   'settled'   問過了，沒有欠著的沙盒。空清單此刻才真的是「你還沒有缸」。
 *   'failed'    補建失敗。首頁會給一列提示與重試；其餘頁面退回自己的空狀態。
 */
export type GuestSandboxState = 'unknown' | 'preparing' | 'settled' | 'failed'

/**
 * 補建那一次請求的時間預算（毫秒）。
 *
 * 這支端點背後是一個 30 秒上限的交易加上 10 秒等連線，所以它**可以**合法地跑很久。
 * 但「跑很久」與「再也不回來」在畫面上長得一樣：少了這個上限，請求掛住時 promise
 * 不會 reject，畫面就永遠停在「正在準備示範資料」，而那一態刻意沒有任何出口。
 * 45 秒 ＝ 端點自己的上限（30 + 10）再加一點餘裕。
 */
export const SANDBOX_TIMEOUT_MS = 45_000

export interface GuestSandbox {
  state: Ref<GuestSandboxState>
  /** 這一刻該不該把空清單畫成「正在準備」而不是「還沒有任何缸」 */
  preparing: ComputedRef<boolean>
  /** 補建失敗。首頁據此顯示提示；其餘頁面退回自己的空狀態 */
  failed: ComputedRef<boolean>
  /** 重試進行中（按鈕轉圈並按不下去，連按不會疊出好幾輪同樣的寫入） */
  retrying: Readonly<Ref<boolean>>
  /** 拿到空的缸清單時呼叫。全站只會真的問一次。 */
  ensure: (reload: () => Promise<unknown>) => Promise<void>
  /** 失敗之後再試一次 */
  retry: (reload: () => Promise<unknown>) => Promise<void>
}

export function useGuestSandbox(): GuestSandbox {
  // useState 而不是模組層的 ref：跨頁共用同一份，而且 SPA 內換頁不會重置
  const state = useState<GuestSandboxState>('guest-sandbox', () => 'unknown')
  const retrying = useState('guest-sandbox:retrying', () => false)

  // $api 而不是裸 $fetch：session 過期時要被帶去登入頁，而不是停在一頁空資料上（#67）
  const { $api } = useNuxtApp()

  async function request(reload: () => Promise<unknown>) {
    state.value = 'preparing'

    try {
      await $api<GuestSandboxResponse>('/api/guest-sandbox', {
        method: 'POST',
        timeout: SANDBOX_TIMEOUT_MS,
      })

      // ⚠ 不管回的是什麼都要重新取一次，**不能只在 alreadySeeded 為 false 時才取**。
      //
      // 複製可能是別人做的：冪等鎖（server/utils/guestSandbox.ts）保證只有一個呼叫者
      // 真的複製，另一個分頁、或先前一次還在路上的請求，都會拿到 alreadySeeded: true
      // ——而那一刻資料其實已經進來了。只在 false 時重取的話，這一頁會永遠停在
      // 「還沒有任何缸」，而同一時間 /api/tanks 明明回得出缸。
      // 實際踩過（PR #145 的 E2E，畫面等了 34 次輪詢仍是空狀態）。
      await reload()

      state.value = 'settled'
    }
    catch {
      state.value = 'failed'
    }
  }

  /**
   * 只問一次。
   *
   * 這道閘門不能省：`request` 成功時會 `reload()`，data 因此再變一次、呼叫端的 watcher
   * 於是又醒過來。少了它，沙盒真的空著的帳號（模板沒 seed、或根本不是訪客）
   * 會無限重打——而每一次都是一支會寫入的 API。
   */
  async function ensure(reload: () => Promise<unknown>) {
    if (state.value !== 'unknown') {
      return
    }

    await request(reload)
  }

  async function retry(reload: () => Promise<unknown>) {
    if (retrying.value) {
      return
    }

    retrying.value = true

    try {
      await request(reload)
    }
    finally {
      retrying.value = false
    }
  }

  return {
    state,
    preparing: computed(() => state.value === 'unknown' || state.value === 'preparing'),
    failed: computed(() => state.value === 'failed'),
    retrying: readonly(retrying),
    ensure,
    retry,
  }
}
