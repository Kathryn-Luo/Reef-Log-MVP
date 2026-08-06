import { describe, expect, it, vi } from 'vitest'
import type { AsyncDataRequestStatus } from '#app'
import { useLoadFailure } from '../../../app/composables/useLoadFailure'

// issue #132：三頁判斷「拿不到資料」與重試的寫法一模一樣，收在同一支 composable。
// 各頁真的接上了沒有由 tests/unit/pages/*.test.ts 各自驗，這裡驗的是規則本身。

function status(initial: AsyncDataRequestStatus) {
  return ref<AsyncDataRequestStatus>(initial)
}

describe('useLoadFailure', () => {
  it('全部成功時不算失敗', () => {
    const failure = useLoadFailure([status('success'), status('success')], () => Promise.resolve())

    expect(failure.failed.value).toBe(false)
  })

  // 半頁真資料配半頁空狀態比整頁錯誤更難看懂，所以任何一支失敗就算整頁失敗
  it('任何一支失敗就算整頁失敗', () => {
    const failure = useLoadFailure([status('success'), status('error')], () => Promise.resolve())

    expect(failure.failed.value).toBe(true)
  })

  // 「成功但空」不是失敗——這是本 issue 的另一半，兩者必須分得出來
  it('載入中與尚未開始都不算失敗', () => {
    const failure = useLoadFailure([status('pending'), status('idle')], () => Promise.resolve())

    expect(failure.failed.value).toBe(false)
  })

  // 重試期間 status 從 'error' 翻成 'pending'，只看 error 的話錯誤區塊會被拆掉，
  // 畫面閃過一次空狀態
  it('重試進行中仍算失敗，直到請求落地', async () => {
    const tanks = status('error')
    let release: (() => void) | undefined

    const failure = useLoadFailure([tanks], () => new Promise<void>((resolve) => {
      release = resolve
    }))

    const pending = failure.retry()

    // 請求已經送出，status 也已經不再是 'error'，但畫面不能因此鬆手
    tanks.value = 'pending'
    expect(failure.retrying.value).toBe(true)
    expect(failure.failed.value).toBe(true)

    tanks.value = 'success'
    expect(failure.failed.value).toBe(true)

    release!()
    await pending

    expect(failure.retrying.value).toBe(false)
    expect(failure.failed.value).toBe(false)
  })

  it('重試又失敗時留在失敗狀態', async () => {
    const tanks = status('error')
    const failure = useLoadFailure([tanks], () => Promise.resolve())

    await failure.retry()

    expect(failure.retrying.value).toBe(false)
    expect(failure.failed.value).toBe(true)
  })

  // retry 掛在 @retry 上，讓它 reject 只會變成未處理的錯誤
  it('reload 自己拋錯時不外洩，重試旗標照樣收掉', async () => {
    const tanks = status('error')
    const reload = vi.fn(() => Promise.reject(new Error('boom')))

    const failure = useLoadFailure([tanks], reload)

    await expect(failure.retry()).resolves.toBeUndefined()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(failure.retrying.value).toBe(false)
  })
})
