import type { TankOption } from '../types/home'

// 「移動到其他缸」（issue #120）畫面上算得出來的東西。
//
// 與 shared/utils/creatureDetail.ts 同一個位置：詳情頁與 sheet 都用得到，
// 而且都是純字串推算，測試不需要 DOM 也不需要資料庫。

/** 缸的一行說明：「4 尺 · 420 L」。兩個欄位都是選填，缺一個時不留下孤零零的分隔點 */
export function formatTankSpec(tank: Pick<TankOption, 'sizeSpec' | 'volumeLiters'>): string {
  return [tank.sizeSpec, tank.volumeLiters === null ? null : `${tank.volumeLiters} L`]
    .filter(Boolean)
    .join(' · ')
}

/** 缸沒設色時退回主色，代表色點不會變成一塊空白（與 TankHeader 同一個退路） */
const FALLBACK_COLOR = '#2dd4bf'
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** 缸的代表色點。存進去的色碼不合法時一律退回主色，而不是畫出一塊瀏覽器猜出來的顏色 */
export function tankDotColor(tank: Pick<TankOption, 'colorHex'>): string {
  return tank.colorHex && HEX_COLOR.test(tank.colorHex) ? tank.colorHex : FALLBACK_COLOR
}

/**
 * 失敗之後畫面上唯一走得下去的那個動作。
 *
 * - `choose-other`：這個目標不行（400 / 404），只能換一個。**不出現「重試」**——
 *   再送一次同一個目標只會再收到一次同樣的錯誤。
 * - `retry`：這一次沒送成（離線、5xx、function 掛掉），重送有意義。
 */
export type MoveFailureAction = 'choose-other' | 'retry'

export interface MoveFailureView {
  action: MoveFailureAction
  /** 錯誤卡片的內文：指名目標缸 · 說明原因 · 明說後果 */
  message: string
  /** 這個目標缸要不要從清單移除。只有 404——它已經不在了，留著只會被再點一次 */
  dropTarget: boolean
}

export interface MoveFailureContext {
  creatureName: string
  /**
   * 這一頁**以為**牠所在的缸。畫面不做樂觀更新，所以正常情況下就是原本那一個。
   *
   * 只有 404 與「送不出去」那兩支用得到它。400 不用——那一支的成因正是這個值已經過期
   * （見底下的註解），拿它去講「仍留在這一缸」會講出一句假話。
   */
  currentTankName: string
  targetTankName: string
}

/**
 * 把換缸 API 的失敗翻成畫面要說的那一句，以及接下來能做什麼。
 *
 * 三件事一起決定：內文、主要動作、要不要把目標缸從清單移除。分開決定的話，畫面會出現
 * 「主鈕說重試、清單裡卻已經沒有那個目標」這種互相矛盾的組合。
 *
 * 內文一律講滿三件事——指名是哪一缸、為什麼失敗、以及**後果**。少了最後一句，
 * 人會不確定「那牠現在到底在哪一缸」，而這一頁正在同時顯示著答案。
 */
export function describeMoveFailure(
  status: number | null,
  { creatureName, currentTankName, targetTankName }: MoveFailureContext,
): MoveFailureView {
  const consequence = `${creatureName}仍留在${currentTankName}，未被移動。`

  if (status === 404) {
    return {
      action: 'choose-other',
      message: `找不到「${targetTankName}」，它可能已被封存或刪除（404）。${consequence}`,
      dropTarget: true,
    }
  }

  if (status === 400) {
    return {
      action: 'choose-other',
      // 400 是「來源與目標相同」，而目前所在的缸不會列進清單——所以收到它就代表
      // **這一頁的資料已經過期**：牠已經被別的分頁或別台裝置移走了，而且正好移到
      // 這裡選中的這一缸。
      //
      // 所以這一句刻意**不接 consequence**。「仍留在 <舊缸>」在這個情境下是假的：
      // 資料庫裡牠正在目標缸。寧可說「這一頁的資料過期了」，也不要講一句可能為假的話。
      message: `無法移動到「${targetTankName}」（400）。這一頁的資料可能已經不是最新的，`
        + `已重新載入，請確認${creatureName}目前在哪一缸。`,
      dropTarget: false,
    }
  }

  return {
    action: 'retry',
    message: `移動到「${targetTankName}」時沒有送出成功，可能是連線中斷或伺服器沒有回應。${consequence}`,
    dropTarget: false,
  }
}
