import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import LoadErrorState from '../../../app/components/LoadErrorState.vue'

// issue #132：三頁的錯誤區塊長得一樣，抽成共用元件才不會再各自漂走。
// 這裡守的是它的契約——文案說的是「拿不到資料」、只有一個出口（重試），
// 以及那個出口真的把事件送出去。各頁怎麼接由 pages/*.test.ts 各自驗。

describe('LoadErrorState', () => {
  // Then 畫面顯示「載入失敗」與重試的入口
  it('顯示「載入失敗」與一顆「重試」', async () => {
    const state = await mountSuspended(LoadErrorState)

    expect(state.get('[data-testid="load-error-title"]').text()).toBe('載入失敗')
    expect(state.get('[data-testid="load-error-retry"]').text()).toContain('重試')
  })

  // 說的必須是「拿不到資料」，不是「你沒有資料」——這兩句話是本 issue 的全部
  it('說明文字講的是拿不到資料，沒有把它說成「還沒有任何」', async () => {
    const state = await mountSuspended(LoadErrorState)
    const description = state.get('[data-testid="load-error-description"]').text()

    expect(description).toContain('拿不到')
    expect(description).not.toContain('還沒有')
  })

  // And 我不會被引導去建立第二個缸：這一區刻意沒有任何連出去的入口
  it('沒有任何連結，唯一的出口是重試', async () => {
    const state = await mountSuspended(LoadErrorState)

    expect(state.findAll('a')).toHaveLength(0)
    expect(state.findAll('button')).toHaveLength(1)
  })

  // When 我點「重試」
  it('點下去發出 retry 事件', async () => {
    const state = await mountSuspended(LoadErrorState)

    await state.get('[data-testid="load-error-retry"]').trigger('click')

    expect(state.emitted('retry')).toHaveLength(1)
  })

  // 重試進行中要按不下去：連按只會疊出好幾輪同樣的請求
  it('重試進行中時按鈕按不下去', async () => {
    const state = await mountSuspended(LoadErrorState, { props: { retrying: true } })

    expect(state.get('[data-testid="load-error-retry"]').attributes('disabled')).toBeDefined()
  })

  // 失敗是要讓人知道的事，不是靜靜換掉一塊畫面
  it('整區是 role="alert"，讀螢幕的人也會被告知', async () => {
    const state = await mountSuspended(LoadErrorState)

    expect(state.get('[data-testid="load-error"]').attributes('role')).toBe('alert')
  })

  // 錯誤區塊整頁取代掉內容的那幾頁（首頁、生物庫存、生物詳情），
  // 這一刻它是頁面上唯一的標題
  it('預設用 h1 當標題', async () => {
    const state = await mountSuspended(LoadErrorState)

    expect(state.get('[data-testid="load-error-title"]').element.tagName).toBe('H1')
  })

  // /log 的頁首「記錄水質」是常駐的 h1，這裡再給一個就是同一頁兩個 h1
  it('titleTag 傳 p 時不再多產生一個 h1', async () => {
    const state = await mountSuspended(LoadErrorState, { props: { titleTag: 'p' } })

    expect(state.get('[data-testid="load-error-title"]').element.tagName).toBe('P')
    expect(state.findAll('h1')).toHaveLength(0)
  })
})
