import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { backgroundAlpha } from './support/css-colour'

// 首頁 · 生物優先（Epic #1 screen-1）。
//
// 前提：preview 環境需有 seed 資料（`prisma/seed.ts`，PR #49）——一位使用者、
// 一個名為「主缸」的缸（4 尺 / SPS MIXED / 420L）、一筆數小時前的水質記錄與 12 隻生物，
// 外加兩個尚無水質記錄的缸。sticky 的 spec 需要生物多到捲得動，資料量變少時要一併回頭調整。

// Given 我有一個名為「主缸」的缸，設定為 4 尺 / SPS MIXED / 420L / When 我開啟首頁
// Then 頁首顯示缸的代表色塊、缸名「主缸 · 4 尺」與副標「SPS MIXED · 420L」，缸名右側有可切換的 ∨
test('頁首顯示缸名、副標與色塊', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('主缸 · 4 尺')
  await expect(page.getByTestId('tank-subtitle')).toHaveText('SPS MIXED · 420L')
  await expect(page.getByTestId('tank-color')).toBeVisible()
  await expect(page.getByTestId('tank-switch')).toBeVisible()
})

// Given 我有兩個以上未封存的缸 / When 我點擊缸名旁的 ∨ / Then 出現缸切換選單
// When 我選擇另一個缸 / Then 首頁的水質摘要與生物列表改為顯示該缸的資料
test('切換缸之後水質摘要與生物列表跟著換', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('tank-switch').click()

  const options = page.getByTestId('tank-menu').getByRole('option')
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')

  const before = await page.getByRole('heading', { level: 1 }).textContent()
  await options.nth(1).click()

  await expect(page.getByTestId('tank-menu')).toBeHidden()
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(before ?? '')
})

// Given 該缸最新一筆水質記錄為 4 小時前，其中 Mg 低於正常區間、NO₃ 高於正常區間
// Then 顯示「水質」標題、橘色徽章「2 需注意」與相對時間
// And 六項元素 KH / Ca / Mg / NO₃ / PO₄ / 鹽 以彩色數字並排顯示
// And 正常項為綠色、偏低為藍色、偏高為橘色
test('水質摘要列顯示需注意數量、相對時間與六項彩色數字', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('water-title')).toHaveText('水質')
  await expect(page.getByTestId('water-attention')).toHaveText('2 需注意')
  await expect(page.getByTestId('water-measured-at')).toContainText('·')

  await expect(page.getByTestId('water-reading-label')).toHaveText(['KH', 'Ca', 'Mg', 'NO₃', 'PO₄', '鹽'])

  const values = page.getByTestId('water-reading-value')
  await expect(values.nth(2)).toHaveAttribute('data-status', 'low')
  await expect(values.nth(3)).toHaveAttribute('data-status', 'high')
})

// Given 該缸有 12 隻生物：魚 5、珊瑚 6、其他 1
// Then 「生物」標題右側顯示「12 隻」，並有 4 個分類 chip：全部 / 魚 5 / 珊瑚 6 / 其他 1
// When 我點擊「魚 5」/ Then 卡片網格只顯示 category 為 FISH 的生物，該 chip 呈選中態
test('分類 chip 篩選出對應分類的生物', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('creature-total')).toHaveText('12 隻')
  await expect(page.getByTestId('creature-chip')).toHaveText(['全部', '魚 5', '珊瑚 6', '其他 1'])

  const fishChip = page.getByTestId('creature-chip').nth(1)
  await fishChip.click()

  await expect(fishChip).toHaveAttribute('aria-pressed', 'true')
  const categories = await page.getByTestId('creature-category').allTextContents()
  expect(new Set(categories)).toEqual(new Set(['魚']))
})

// Given 生物卡片網格中有存活、生病、死亡三種狀態的生物 / When 卡片渲染
// Then 狀態點分別為存活綠 / 生病橘 / 死亡灰，生病卡片顯示「⚠ 觀察中」
// Given 該缸有兩隻同名的「公子小丑」/ Then 兩者合併為一張「公子小丑 ×2」
test('卡片顯示分類、狀態與同名合併的 ×N', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('creature-card').first()).toBeVisible()
  await expect(page.getByTestId('creature-watch-flag').first()).toContainText('觀察中')
  await expect(page.getByTestId('creature-title').filter({ hasText: '×2' })).toHaveCount(1)
})

// Given 我在首頁 / When 我點擊任一張生物卡片 / Then 導向該生物的「生物詳情」頁
test('點擊生物卡片導向生物詳情頁', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('creature-card').first().getByRole('link').click()

  await expect(page).toHaveURL(/\/creatures\/[^/]+$/)
})

// ── sticky 頁首（issue #48）────────────────────────────────────────────────
//
// 手機尺寸才是這個 Story 的情境：12 隻生物在 390×844 下必定超過一個螢幕。

/** 捲到指定位置（超過頁面高度就捲到底），再等捲動位置定下來才回傳 */
async function scrollTo(page: Page, offset: number) {
  const target = await page.evaluate((top) => {
    const max = document.documentElement.scrollHeight - window.innerHeight
    const clamped = Math.max(0, Math.min(top, max))

    window.scrollTo({ top: clamped, behavior: 'instant' })

    return clamped
  }, offset)

  await page.waitForFunction(top => Math.abs(window.scrollY - top) < 2, target)
}

test.describe('sticky 頁首', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  // Given 我在首頁且生物卡片多到可以捲動 / When 我向下捲動
  // Then 缸別頁首與水質摘要列固定在畫面頂端，持續可見
  // Then「生物 N 隻」標題列與分類 chip 列隨卡片網格一起捲離畫面，不固定在頂端
  test('向下捲動後頁首與水質列留在畫面上，標題列與 chip 列捲離畫面', async ({ page }) => {
    await page.goto('/')

    const heading = page.getByRole('heading', { level: 1 })
    const waterTitle = page.getByTestId('water-title')
    const total = page.getByTestId('creature-total')
    const firstChip = page.getByTestId('creature-chip').first()

    // 未捲動時五個區塊都在
    await expect(heading).toBeInViewport()
    await expect(total).toBeInViewport()
    await expect(firstChip).toBeInViewport()
    await expect(page.getByTestId('water-reading')).toHaveCount(6)

    await scrollTo(page, 1200)

    await expect(heading).toBeInViewport()
    await expect(waterTitle).toBeInViewport()
    await expect(total).not.toBeInViewport()
    await expect(firstChip).not.toBeInViewport()
  })

  // And 頁首收合為兩層：缸副標與六格數字讓位，固定區明顯變矮
  test('向下捲動後頁首收合，固定區高度明顯縮小', async ({ page }) => {
    await page.goto('/')

    const header = page.getByTestId('home-sticky-header')
    await expect(header).toHaveAttribute('data-collapsed', 'false')
    const expandedHeight = (await header.boundingBox())!.height

    await scrollTo(page, 1200)

    await expect(header).toHaveAttribute('data-collapsed', 'true')

    // issue #55 之後讓位的節點留在 DOM 裡（CSS 補不了節點增減的間），
    // 所以看的是「整塊收到 0 高、並對輔助技術隱藏」
    await expect(page.getByTestId('water-readings-slot')).toHaveAttribute('aria-hidden', 'true')
    await expect(page.getByTestId('tank-subtitle-slot')).toHaveAttribute('aria-hidden', 'true')
    await expect
      .poll(async () => (await page.getByTestId('water-readings-slot').boundingBox())!.height)
      .toBe(0)
    expect((await page.getByTestId('tank-subtitle-slot').boundingBox())!.height).toBe(0)

    // 留下的是捲動時要隨時看得到的兩件事
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('主缸 · 4 尺')
    await expect(page.getByTestId('water-attention')).toBeVisible()

    // 設計稿是 ~236px → ~92px；抓一半當門檻，量測誤差不會讓它偽陽性
    const collapsedHeight = (await header.boundingBox())!.height
    expect(collapsedHeight).toBeLessThan(expandedHeight / 2)
  })

  // Given 我向下捲動，生物卡片正從固定的頁首下方通過 / When 我觀察兩者交界
  // Then 卡片被頁首遮住而不是蓋在頁首上（頁首在上層）
  test('生物卡片從固定的頁首下方穿過，頁首在上層', async ({ page }) => {
    await page.goto('/')
    await scrollTo(page, 1200)

    const header = page.getByTestId('home-sticky-header')
    const box = (await header.boundingBox())!

    // 頁首底邊上方一點的位置，此時正有生物卡片經過——命中的必須是頁首而不是卡片
    const hit = await page.evaluate(
      point => document.elementFromPoint(point.x, point.y)?.closest('[data-testid]')?.getAttribute('data-testid') ?? null,
      { x: box.x + box.width / 2, y: box.y + box.height - 4 },
    )

    expect(hit).not.toBe('creature-card')
    await expect(header).toBeInViewport()
  })

  // Given 我向下捲動後再向上捲回頂端 / When 捲動位置回到 0
  // Then 版面回到初始樣態，與「尚未捲動」時一致
  test('捲回頂端後版面回到初始樣態', async ({ page }) => {
    await page.goto('/')

    const total = page.getByTestId('creature-total')
    const header = page.getByTestId('home-sticky-header')
    const before = await header.innerHTML()
    const expandedHeight = (await header.boundingBox())!.height

    await scrollTo(page, 1200)
    await expect(header).toHaveAttribute('data-collapsed', 'true')

    await scrollTo(page, 0)

    await expect(header).toHaveAttribute('data-collapsed', 'false')
    await expect(total).toBeInViewport()
    await expect(page.getByTestId('creature-chip').first()).toBeInViewport()
    await expect(page.getByTestId('water-reading')).toHaveCount(6)
    expect(await header.innerHTML()).toBe(before)

    // 展開是過場，高度要等它播完才回到原值
    await expect.poll(async () => (await header.boundingBox())!.height).toBe(expandedHeight)
  })

  // Given 固定的頁首與底部 tab 列同時在畫面上 / When 我捲動頁面
  // Then 底部 tab 列位置與外觀不變，且不被固定的頁首覆蓋
  test('底部 tab 列不受固定頁首影響', async ({ page }) => {
    await page.goto('/')

    const tabBar = page.getByRole('navigation', { name: '主要導覽' })
    const before = await tabBar.boundingBox()

    await scrollTo(page, 1200)

    await expect(tabBar).toBeInViewport()
    expect(await tabBar.boundingBox()).toEqual(before)

    // 五個 tab 都還點得到——被頁首蓋住的話這裡會逾時
    await expect(tabBar.getByRole('link')).toHaveCount(5)
    await tabBar.getByRole('link').nth(2).click()
    await expect(page).toHaveURL(/\/trends$/)
  })

  // Given 頁首已固定在頂端 / When 我點開切換缸的下拉選單
  // Then 選單完整顯示在生物卡片之上，不被卡片蓋住、不被 sticky 區裁切
  test('收合狀態下切換缸的選單完整顯示在卡片之上', async ({ page }) => {
    await page.goto('/')
    await scrollTo(page, 1200)
    await expect(page.getByTestId('home-sticky-header')).toHaveAttribute('data-collapsed', 'true')

    await page.getByTestId('tank-switch').click()

    const menu = page.getByTestId('tank-menu')
    await expect(menu).toBeVisible()
    await expect(menu).toBeInViewport()

    // 每一個選項都點得到——被卡片蓋住或被容器裁掉的話這裡會失敗
    const options = menu.getByRole('option')
    await expect(options.first()).toBeVisible()
    await expect(options.last()).toBeVisible()

    const box = (await options.last().boundingBox())!
    const hit = await page.evaluate(
      point => document.elementFromPoint(point.x, point.y)?.closest('[data-testid]')?.getAttribute('data-testid') ?? null,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    )
    expect(hit).toBe('tank-menu')
  })

  // ── 收合過場（issue #55）──────────────────────────────────────────────
  //
  // 過場驗得到的只有「中途真的出現過中間值」與「不動的東西沒被帶著動」，
  // 別去斷言具體毫秒數——機器慢一點就會偽陰性。

  /**
   * 捲到 offset，並從捲動前一格開始用 rAF 逐幀量測：
   * 固定區高度、底部 tab 列位置、第一張生物卡片位置。
   */
  async function sampleDuringCollapse(page: Page, offset: number) {
    return page.evaluate(async (top) => {
      const header = document.querySelector('[data-testid="home-sticky-header"]')!
      const tabBar = document.querySelector('nav[aria-label="主要導覽"]')!
      const card = document.querySelector('[data-testid="creature-card"]')!

      const headerHeights: number[] = []
      const tabBarTops: number[] = []
      const cardTops: number[] = []
      let done = false

      const sample = () => {
        headerHeights.push(header.getBoundingClientRect().height)
        tabBarTops.push(tabBar.getBoundingClientRect().top)
        cardTops.push(card.getBoundingClientRect().top)

        if (!done) {
          requestAnimationFrame(sample)
        }
      }

      // 先量一格「還沒捲」的，再翻轉，之後每一幀都量
      sample()
      window.scrollTo({ top, behavior: 'instant' })

      await new Promise((resolve) => {
        setTimeout(resolve, 600)
      })
      done = true

      return { headerHeights, tabBarTops, cardTops }
    }, offset)
  }

  /** 嚴格落在展開與收合之間的取樣格數（留 1px 容差，避開量測誤差） */
  function midwayFrames(heights: number[]): number[] {
    const expanded = Math.max(...heights)
    const collapsed = Math.min(...heights)

    return heights.filter(height => height > collapsed + 1 && height < expanded - 1)
  }

  // Given 我在首頁，頁面尚未捲動 / When 我向下捲動超過收合門檻
  // Then 頁首的高度以過場動畫平滑變化，不是瞬間跳掉
  test('收合時固定區高度平滑變化，中途量得到展開與收合之間的高度', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('home-sticky-header')).toHaveAttribute('data-collapsed', 'false')

    const { headerHeights } = await sampleDuringCollapse(page, 1200)

    expect(Math.min(...headerHeights)).toBeLessThan(Math.max(...headerHeights) / 2)
    expect(midwayFrames(headerHeights).length).toBeGreaterThan(0)
  })

  // Given 頁首已收合 / When 我向上捲回頂端、頁首展開 / Then 展開同樣有過場
  test('展開時同樣有過場，方向與收合對稱', async ({ page }) => {
    await page.goto('/')
    await scrollTo(page, 1200)
    await expect(page.getByTestId('home-sticky-header')).toHaveAttribute('data-collapsed', 'true')

    const { headerHeights } = await sampleDuringCollapse(page, 0)

    // 展開：由矮變高，中途一樣量得到中間值
    expect(headerHeights.at(-1)!).toBeGreaterThan(headerHeights[0]!)
    expect(midwayFrames(headerHeights).length).toBeGreaterThan(0)
  })

  // Given 我的系統設定為「減少動態效果」/ When 頁首收合或展開
  // Then 直接切換、不播放過場（維持 #48 的行為）
  test('「減少動態效果」時直接切換，不播過場', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')

    // 讓位區塊根本沒有可過場的屬性
    const property = await page
      .getByTestId('water-readings-slot')
      .evaluate(element => getComputedStyle(element).transitionProperty)
    expect(property).toBe('none')

    const { headerHeights } = await sampleDuringCollapse(page, 1200)

    // 高度只會有展開與收合兩種，中間一格都不該出現
    expect(Math.min(...headerHeights)).toBeLessThan(Math.max(...headerHeights) / 2)
    expect(midwayFrames(headerHeights)).toEqual([])
  })

  // Given 頁首正在播放過場 / When 我觀察畫面其他部分
  // Then 底部 tab 列不移動，生物卡片不因過場而跳動或閃爍
  test('過場進行中底部 tab 列不移動，生物卡片不回彈', async ({ page }) => {
    await page.goto('/')

    const { tabBarTops, cardTops } = await sampleDuringCollapse(page, 1200)

    // tab 列是 fixed，固定區變矮不該把它一起帶走
    expect(new Set(tabBarTops).size).toBe(1)

    // 卡片跟著固定區一路往上，中途不能往回跳（往回一格就是肉眼看得到的抖動）
    const rebounds = cardTops.filter((top, index) => index > 0 && top > cardTops[index - 1]! + 1)
    expect(rebounds).toEqual([])
  })

  // Given 我持續快速捲動、經過門檻多次 / When 前一次過場尚未播完就再次翻轉
  // Then 頁首不會卡在中間狀態，最終樣態與當下的捲動位置一致
  test('快速來回翻轉門檻後，頁首不卡在中間狀態', async ({ page }) => {
    await page.goto('/')

    const header = page.getByTestId('home-sticky-header')
    const expandedHeight = (await header.boundingBox())!.height

    // 不等過場播完就翻下一次
    await page.evaluate(async () => {
      for (const top of [1200, 0, 900, 0, 600]) {
        window.scrollTo({ top, behavior: 'instant' })
        await new Promise((resolve) => {
          setTimeout(resolve, 40)
        })
      }
    })

    await expect(header).toHaveAttribute('data-collapsed', 'true')
    await expect.poll(async () => (await header.boundingBox())!.height).toBeLessThan(expandedHeight / 2)

    await scrollTo(page, 0)

    await expect(header).toHaveAttribute('data-collapsed', 'false')
    await expect.poll(async () => (await header.boundingBox())!.height).toBe(expandedHeight)
  })

  // Given 我重新整理頁面，而瀏覽器還原到一個已經超過門檻的捲動位置
  // When 畫面首次渲染 / Then 頁首直接以收合樣態出現，不會先展開再播一次收合動畫
  test('還原到已捲動的位置時，首幀直接是收合樣態、不補播收合動畫', async ({ page }) => {
    await page.goto('/')
    await scrollTo(page, 1200)

    const header = page.getByTestId('home-sticky-header')
    await expect(header).toHaveAttribute('data-collapsed', 'true')
    const collapsedHeight = (await header.boundingBox())!.height

    // 瀏覽器會還原捲動位置，重新整理後應該直接落在收合樣態
    await page.reload()
    await expect(header).toHaveAttribute('data-collapsed', 'true')

    // 逐幀量：整段期間都是收合高度，沒有從展開演過來的那一段
    const { headerHeights } = await sampleDuringCollapse(page, 1200)
    expect(Math.max(...headerHeights)).toBeLessThan(collapsedHeight + 2)
  })

  // Given 該缸尚無任何水質記錄 / When 我向下捲動
  // Then 頁首與水質摘要列照常固定在頂端，水質摘要列維持空狀態內容，不顯示需注意徽章
  //
  // seed 的「小缸」沒有水質記錄，改看它即可（tank-menu 的第二個選項）。
  // 它同時也沒有生物、捲不動，所以這裡只驗「空狀態照常留在頂端」；
  // 「收合後空狀態仍完整」由 unit 測試（tests/unit/pages/home.test.ts）涵蓋。
  test('沒有水質記錄的缸，固定的水質摘要列維持空狀態', async ({ page }) => {
    await page.goto('/')

    await page.getByTestId('tank-switch').click()
    await page.getByTestId('tank-menu').getByRole('option').nth(1).click()
    await expect(page.getByTestId('water-empty')).toBeVisible()

    await scrollTo(page, 600)

    await expect(page.getByTestId('water-title')).toBeInViewport()
    await expect(page.getByTestId('water-empty')).toBeInViewport()
    await expect(page.getByTestId('water-empty-action')).toHaveText('記錄水質')
    await expect(page.getByTestId('water-attention')).toHaveCount(0)
  })
})

// ── 數據儀表板 bottom sheet（issue #10）──────────────────────────────────
//
// screen-2：點一下水質摘要列，由下方升起完整的儀表板。
// 前提同上——seed 的「主缸」有一筆數小時前的水質記錄與四筆歷史記錄（趨勢線的來源）。

test.describe('數據儀表板', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  /** 點水質摘要列展開儀表板，等它真的升起來 */
  async function openDashboard(page: Page) {
    await page.goto('/')
    await page.getByTestId('water-summary-card').click()
    await expect(page.getByTestId('water-dashboard-sheet')).toBeVisible()
  }

  // Given 我在首頁，水質摘要列為收合狀態 / When 我點擊水質摘要列（或「詳細 ∨」）
  // Then 由下方升起 bottom sheet，標題為「數據儀表板」，副標為「<缸名> · 更新於 N 小時前」
  // And 背景首頁內容變暗但仍可見
  test('點擊水質摘要列升起儀表板，背景首頁仍看得見', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByTestId('water-detail-hint')).toContainText('詳細')
    await expect(page.getByTestId('water-dashboard')).toHaveCount(0)

    await page.getByTestId('water-summary-card').click()

    await expect(page.getByTestId('water-dashboard-title')).toHaveText('數據儀表板')
    await expect(page.getByTestId('water-dashboard-subtitle')).toHaveText(/^主缸 · (更新於 .+前|剛剛更新)$/)

    // 面板貼齊畫面底部，是「由下方升起」而不是浮在中間
    const sheet = (await page.getByTestId('water-dashboard-sheet').boundingBox())!
    expect(Math.abs(sheet.y + sheet.height - page.viewportSize()!.height)).toBeLessThan(2)

    // 背景變暗但仍可見：遮罩是半透明的，首頁的缸名還在畫面上。
    //
    // 驗的是解析出來的 alpha，不是顏色字串的長相：Tailwind v4 的 `bg-black/60` 走
    // `color-mix()` 算在 oklab 色彩空間，computed value 是 `oklab(0 0 0 / 0.6)` 而不是
    // `rgba(...)`（issue #97）。0 與 1 兩側都要——全黑不透明與整個消失都不算「變暗但仍可見」。
    const alpha = await backgroundAlpha(page.getByTestId('water-dashboard-backdrop'))
    expect(alpha).toBeGreaterThan(0)
    expect(alpha).toBeLessThan(1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('主缸 · 4 尺')
  })

  // Given 該缸最新一筆水質記錄包含六個測項 / When 儀表板展開
  // Then 依序列出 KH / Ca / Mg / NO₃ / PO₄ / 鹽度六列
  // And 每列顯示：測項名、數值、單位、迷你趨勢線、狀態文字與區間
  test('六列測項各自帶著數值、單位、趨勢線與區間', async ({ page }) => {
    await openDashboard(page)

    await expect(page.getByTestId('water-dashboard-label')).toHaveText([
      'KH',
      'Ca',
      'Mg',
      'NO₃',
      'PO₄',
      '鹽度',
    ])
    await expect(page.getByTestId('water-dashboard-unit')).toHaveText([
      'dKH',
      'ppm',
      'ppm',
      'ppm',
      'ppm',
      'SG',
    ])

    // seed 的四筆歷史記錄涵蓋全部六個測項，每一列都畫得出折線
    await expect(page.getByTestId('water-dashboard-trend')).toHaveCount(6)
  })

  // Given Mg 的最新值為 1180，該缸 Mg 的正常區間為 1250–1350
  // Then 右側顯示藍色「偏低 ▼」與區間文字「1250–1350」，數值同樣以藍色呈現
  test('Mg 偏低：數值與狀態文字同為藍色，右側標出區間', async ({ page }) => {
    await openDashboard(page)

    const row = page.locator('[data-testid="water-dashboard-row"][data-parameter="MG"]')
    const value = row.getByTestId('water-dashboard-value')

    await expect(value).toHaveText('1180')
    await expect(value).toHaveAttribute('data-status', 'low')
    await expect(row.getByTestId('water-dashboard-status')).toHaveText('偏低 ▼')
    await expect(row.getByTestId('water-dashboard-range')).toHaveText('1250–1350')

    // 數值與狀態文字是同一個顏色，而且不是「正常」的主色
    const colours = await row
      .locator('[data-testid="water-dashboard-value"], [data-testid="water-dashboard-status"]')
      .evaluateAll(elements => elements.map(element => getComputedStyle(element).color))
    expect(new Set(colours).size).toBe(1)
  })

  // Given NO₃ 的最新值為 12，該缸 NO₃ 的正常區間為 2–10
  // Then 右側顯示橘色「偏高 ▲」與區間文字「2–10」，數值同樣以橘色呈現
  test('NO₃ 偏高：數值與狀態文字同為橘色，右側標出區間', async ({ page }) => {
    await openDashboard(page)

    const row = page.locator('[data-testid="water-dashboard-row"][data-parameter="NO3"]')

    await expect(row.getByTestId('water-dashboard-value')).toHaveAttribute('data-status', 'high')
    await expect(row.getByTestId('water-dashboard-status')).toHaveText('偏高 ▲')
    await expect(row.getByTestId('water-dashboard-range')).toHaveText('2–10')
  })

  // Given KH 的最新值為 7.8，落在正常區間 7–9 內
  // Then 右側顯示「正常」與區間文字「7–9」
  test('KH 正常：狀態文字為「正常」，右側標出 7–9', async ({ page }) => {
    await openDashboard(page)

    const row = page.locator('[data-testid="water-dashboard-row"][data-parameter="KH"]')

    await expect(row.getByTestId('water-dashboard-value')).toHaveText('7.8')
    await expect(row.getByTestId('water-dashboard-status')).toHaveText('正常')
    await expect(row.getByTestId('water-dashboard-range')).toHaveText('7–9')
  })

  // Given 儀表板已展開 / When 我點擊右上角 ✕ / Then bottom sheet 收合，回到首頁預設狀態
  test('點擊 ✕ 收合，回到首頁預設狀態', async ({ page }) => {
    await openDashboard(page)

    await page.getByTestId('water-dashboard-close').click()

    await expect(page.getByTestId('water-dashboard')).toHaveCount(0)
    await expect(page.getByTestId('water-reading')).toHaveCount(6)
  })

  // When 我點擊背景遮罩 / Then bottom sheet 收合
  test('點擊背景遮罩收合', async ({ page }) => {
    await openDashboard(page)

    // 面板上方那一段才是露出來的遮罩，點畫面正上方即可
    await page.mouse.click(page.viewportSize()!.width / 2, 40)

    await expect(page.getByTestId('water-dashboard')).toHaveCount(0)
  })

  // When 我向下拖曳把手 / Then bottom sheet 收合
  test('向下拖曳把手收合', async ({ page }) => {
    await openDashboard(page)

    const handle = (await page.getByTestId('water-dashboard-handle').boundingBox())!
    const startX = handle.x + handle.width / 2
    const startY = handle.y + handle.height / 2

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    // 分幾步移動，讓 pointermove 真的送得出來
    await page.mouse.move(startX, startY + 80, { steps: 8 })
    await page.mouse.move(startX, startY + 160, { steps: 8 })
    await page.mouse.up()

    await expect(page.getByTestId('water-dashboard')).toHaveCount(0)
  })

  // review 第二輪：把手那條小灰線太細，拖曳範圍擴大到「數據儀表板」標題區塊
  test('從標題區塊向下拖曳也能收合', async ({ page }) => {
    await openDashboard(page)

    const title = (await page.getByTestId('water-dashboard-title').boundingBox())!
    const startX = title.x + title.width / 2
    const startY = title.y + title.height / 2

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX, startY + 80, { steps: 8 })
    await page.mouse.move(startX, startY + 160, { steps: 8 })
    await page.mouse.up()

    await expect(page.getByTestId('water-dashboard')).toHaveCount(0)
  })

  // review 第二輪：展開時原本的頁面要停止捲動，不能在遮罩後面跟著動
  test('展開時背景頁面捲不動，收合後恢復', async ({ page }) => {
    await page.goto('/')
    await scrollTo(page, 400)

    const before = await page.evaluate(() => window.scrollY)

    await page.getByTestId('water-summary-card').click()
    await expect(page.getByTestId('water-dashboard-sheet')).toBeVisible()

    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY))
      .toBe('hidden')

    await page.mouse.wheel(0, 600)
    expect(await page.evaluate(() => window.scrollY)).toBe(before)

    // 背景仍在原本的捲動位置，所以收合後看到的是同一個畫面
    await page.getByTestId('water-dashboard-close').click()
    await expect(page.getByTestId('water-dashboard')).toHaveCount(0)
    expect(await page.evaluate(() => window.scrollY)).toBe(before)

    // 鎖解開了，滾輪又推得動頁面
    await page.mouse.wheel(0, 600)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before)
  })

  // review 第二輪：可滑動的只有數據那一段，標題區塊與「記錄水質」不跟著滑
  test.describe('數據多到超過畫面', () => {
    // 矮一點的畫面才逼得出捲動——六列在 844 高的 iPhone 上塞得下
    test.use({ viewport: { width: 390, height: 480 } })

    test('只有數據區捲動，標題與「記錄水質」留在原位', async ({ page }) => {
      await openDashboard(page)

      const scroller = page.getByTestId('water-dashboard-scroll')
      expect(await scroller.evaluate(element => element.scrollHeight > element.clientHeight + 1))
        .toBe(true)

      const titleBefore = (await page.getByTestId('water-dashboard-title').boundingBox())!.y
      const actionBefore = (await page.getByTestId('water-dashboard-log').boundingBox())!.y

      await scroller.evaluate(element => element.scrollBy(0, 400))
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

      // 捲得到最後一列，標題與底部按鈕卻沒有移動
      await expect(page.locator('[data-testid="water-dashboard-row"][data-parameter="SALINITY"]'))
        .toBeInViewport()
      expect((await page.getByTestId('water-dashboard-title').boundingBox())!.y).toBe(titleBefore)
      expect((await page.getByTestId('water-dashboard-log').boundingBox())!.y).toBe(actionBefore)

      // 數據區捲動不會連帶捲到背景頁面
      expect(await page.evaluate(() => window.scrollY)).toBe(0)
    })
  })

  // 同一個手勢改用「手指」再走一次。
  //
  // iPhone Safari 上原本拖不動：WebKit 的手勢辨識器拖到一半會收走觸控指標並補一個
  // pointercancel，只綁 pointer events 的話拖曳就死在半路（滑鼠不走那條路，所以桌機都正常）。
  // 這裡只跑 Chromium（見 playwright.config.ts），重現不了 WebKit 的收走時機，
  // 守住的是「觸控走的是 touch events，而且拖過門檻真的會關」。
  test.describe('觸控', () => {
    test.use({ hasTouch: true })

    test('用手指向下拖曳把手收合', async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'Input.dispatchTouchEvent 只有 Chromium 的 CDP 有')

      await openDashboard(page)

      const handle = (await page.getByTestId('water-dashboard-handle').boundingBox())!
      const x = handle.x + handle.width / 2
      const y = handle.y + handle.height / 2

      const cdp = await page.context().newCDPSession(page)

      // touchEnd 的 touchPoints 必須是空的，CDP 才收
      const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', offsetY: number) =>
        cdp.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: type === 'touchEnd' ? [] : [{ x, y: y + offsetY }],
        })

      await touch('touchStart', 0)
      // 分幾步移動，讓 touchmove 真的送得出來
      await touch('touchMove', 40)
      await touch('touchMove', 120)
      await touch('touchMove', 180)
      await touch('touchEnd', 180)

      await expect(page.getByTestId('water-dashboard')).toHaveCount(0)
    })
  })

  // Given 儀表板已展開 / When 我點擊底部的「＋ 記錄水質」主要按鈕
  // Then bottom sheet 關閉並導向「記錄水質」頁面
  test('「＋ 記錄水質」關閉儀表板並導向記錄水質頁', async ({ page }) => {
    await openDashboard(page)

    await page.getByTestId('water-dashboard-log').click()

    await expect(page).toHaveURL(/\/log$/)
    await expect(page.getByTestId('water-dashboard')).toHaveCount(0)
  })

  // 頁面捲下去、摘要列收合成單行 pill 之後，它仍然是同一個入口
  test('頁首收合狀態下點摘要列一樣展開儀表板', async ({ page }) => {
    await page.goto('/')
    await scrollTo(page, 1200)
    await expect(page.getByTestId('home-sticky-header')).toHaveAttribute('data-collapsed', 'true')

    await page.getByTestId('water-summary-card').click()

    await expect(page.getByTestId('water-dashboard-title')).toHaveText('數據儀表板')
  })

  // Given 該缸尚無任何水質記錄：沒有東西可攤開，摘要列維持它自己的空狀態入口
  test('沒有水質記錄的缸點摘要列不會展開儀表板', async ({ page }) => {
    await page.goto('/')

    await page.getByTestId('tank-switch').click()
    await page.getByTestId('tank-menu').getByRole('option').nth(1).click()
    await expect(page.getByTestId('water-empty')).toBeVisible()

    await page.getByTestId('water-summary-card').click()

    await expect(page.getByTestId('water-dashboard')).toHaveCount(0)
  })
})
