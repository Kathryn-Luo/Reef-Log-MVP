# Preview 資料庫策略：每個 Preview Deployment 一個 Neon 分支

> 決策記錄。來源：issue #52「E2E 會在共用資料庫留下缸，需要清理策略」。
> 人類於 2026-07-30 選定方向 3。CLAUDE.md 原本要求「導入前需人類決策」，本檔即該決策的落地說明。

## 為什麼改

在 #51 之前，所有 E2E 都是唯讀的（首頁、導覽列），preview 與 production 共用同一個 Neon
分支沒有實際代價。`tests/e2e/tank-create.spec.ts` 是第一支**會寫入**的 E2E，它每跑一次建立 3 個缸：

```
E2E 缸 <timestamp>
E2E 頂欄缸 <timestamp>
E2E 空缸 <timestamp>
```

沒有清理機制，缸只會累積——而且是累積在自己實際使用的資料裡，塞滿頁首的缸切換選單。

`prisma/seed.ts` 已存在（#45），所以 preview 本來就有一份可預期的示範資料，E2E 的斷言依賴它。
任何「清掉測試資料」的方案都得小心不要一起清掉 seed。

### 為什麼選分支隔離，而不是讓測試自己收尾

考慮過的四個方向與各自的問題：

| 方向 | 沒選的理由 |
|---|---|
| 測試 `afterEach` 呼叫刪除 API 收尾 | 目前沒有刪除或封存缸的 API，要先做一支。而認證（#47）還沒落地，等於在公開網址上開一個無身分驗證的破壞性寫入端點 |
| E2E 掛在專用測試使用者底下 | 依賴 #47 決定「使用者」怎麼來，而 #47 卡在人類設 secrets + `schema:design` 兩道前置，尚未開工 |
| E2E 只做唯讀驗證 | 最省事，但 `tank-create.spec.ts` 是目前唯一端對端覆蓋寫入路徑的測試，拿掉等於整個 app 沒有真實寫入的 E2E |
| **每個 preview 一個 Neon 分支**（選定） | — |

選它的關鍵理由：**它不只解掉 E2E 留垃圾，還一併解掉「preview 會不會寫壞 production 資料」這個更大的問題。**
preview 是公開網址、寫入 API 又還沒有認證把關，任何路過的人都可能改到資料——分支隔離讓這件事的
影響範圍縮到那一個 preview。測試清理只處理前者，處理不到後者。

代價：多一層基礎設施設定，且需要人類完成（見下方前置條件）。

## 前置條件（只有人類做得到）

依 CLAUDE.md，agent 不碰 CI 設定、環境變數與 secrets。以下全部需要你在 dashboard 上操作：

1. **在 Vercel 安裝 Neon 官方整合**，連結到本專案與既有的 Neon 專案。
   開啟「為每個 Preview Deployment 建立分支」的選項。
2. **確認整合注入的環境變數名稱**，並補上本專案需要的對應。
   `prisma/schema.prisma` 的 datasource 讀兩個變數：

   ```
   url       = env("DATABASE_URL")   // pooled，host 含 -pooler
   directUrl = env("DIRECT_URL")     // direct，host 不含 -pooler
   ```

   整合注入的 pooled 變數就叫 `DATABASE_URL`，可以直接用；但 **direct 連線的變數名稱與本專案
   期望的 `DIRECT_URL` 不同**（Neon 那邊用的是 unpooled 字樣的名稱）。請對照 Neon 目前的
   Vercel 整合文件確認實際名稱，然後二選一：在 Vercel 上加一個 `DIRECT_URL` 指向它，
   或改 `schema.prisma` 的 `env()` 名稱去對齊整合。**建議前者**——動 schema 會牽動 `docs/SCHEMA_GUIDE.md`
   與所有既有 migration 的前提敘述。
3. **決定 preview 分支的 parent**。Neon 的分支是 parent 的 copy-on-write 複本，所以 parent 有什麼資料、
   新分支就有什麼資料。以 production 分支為 parent，preview 一開就帶著 seed 資料，
   `tests/e2e/*.spec.ts` 現有的斷言不必改。
4. **確認 build 階段的 migration**。新分支繼承 parent 的 schema，所以「PR 沒有新 migration」時什麼都不用做；
   但 PR 帶新 migration 時 preview 需要跑 `prisma migrate deploy`。目前 build script 是
   `prisma generate && nuxt build`，**不含 migrate**。要不要加、以及加了之後 production build
   也會跟著跑 migration 這件事的取捨，是另一個決定——建議連同 #23 一起處理，不要順手加。

## 對其他 issue 的影響

- **#23（把 E2E 接進 CI）**：本檔是它的前置。#23 的 workflow 用 `deployment_status` 事件拿
  `environment_url` 當 `PLAYWRIGHT_BASE_URL`——那個 URL 指向的 deployment 已經綁著自己的 Neon 分支，
  所以 E2E 寫進去的缸隨分支一起被回收，不需要任何 `afterEach` 清理。
  **#52 的結論到此為止，剩下的實作在 #23。**
- **#47（認證）**：分支隔離**不取代**認證。它縮小 preview 寫入的影響範圍，但 production 的寫入 API
  仍然沒有身分驗證。#47 該做的事一件都沒少。
- **`tests/e2e/`**：不需要任何改動。這是選這個方向的附帶好處——現有測試照原樣跑。

## 這個決定的可逆性

若日後 Neon 的分支數量或計費成為問題，退路是回到共用分支 + 把會寫入的 E2E 收斂為唯讀
（#52 的方向 4）。屆時 `tests/e2e/tank-create.spec.ts` 需要拆掉會寫入的 3 支測試，
寫入路徑的覆蓋交回 `tests/unit/`。
