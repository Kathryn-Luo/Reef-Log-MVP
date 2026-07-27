---
name: Epic（畫面拆解用）
about: 貼上 Claude Design 畫面，交給 Agent 拆解成子 issue
title: "[Epic] "
labels: []
---

## Epic 目標
<!-- 一兩句話說明這批畫面要達成什麼 -->

## 畫面
<!--
每個畫面一個區塊，貼上截圖 + 文字描述。
截圖可直接拖曳貼上（GitHub 會自動上傳）。
文字描述越清楚，Agent 拆 issue 品質越好。
-->

### 畫面 1：<名稱>
<!-- 貼截圖 -->
描述：
- 主要元件：
- 使用者互動：
- 資料來源／會寫入什麼：

### 畫面 2：<名稱>
<!-- 貼截圖 -->
描述：

---

## 拆解方式
貼上 `epic:breakdown` label 後，Agent 會：
1. 讀取上方每個畫面
2. 各自產生一個含 User Story（Given/When/Then）的子 issue
3. 自動貼風險分級 label
4. **停下等你 review**，你確認後對子 issue 貼 `agent-go` 才會進入開發
