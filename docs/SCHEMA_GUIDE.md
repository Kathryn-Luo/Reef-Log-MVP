# SCHEMA_GUIDE.md — ReefLog 資料模型設計指引

這份文件給 Agent 在設計 `prisma/schema.prisma` 時遵循，確保跨畫面的
model 命名、型別、關聯一致。人類 review schema 時也以此為對照基準。

---

## Prisma 版本（重要）

本專案鎖定 **Prisma 6**。schema 的 `datasource` block 必須維持以下形式：

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")   // 應用執行期：Neon pooled 連線（host 含 -pooler）
  directUrl = env("DIRECT_URL")     // migration 用：Neon direct 連線（host 不含 -pooler）
}

generator client {
  provider = "prisma-client-js"
}
```

**DB 供應商：Neon（serverless PostgreSQL）**
- `DATABASE_URL`：Neon 的 **pooled** 連線字串（host 名稱含 `-pooler`），
  給應用執行期用，適合 serverless / 短連線。
- `DIRECT_URL`：Neon 的 **direct** 連線字串（host 名稱不含 `-pooler`），
  給 Prisma migration 用。
- 兩條字串都從 Neon 專案 dashboard 的 Connection Details 取得
  （切換 Pooled / Direct 即可看到對應字串）。

不要改成 Prisma 7 的寫法（Prisma 7 才把連線設定移到 `prisma.config.ts`）。
不要升級 Prisma 或任何相依套件。

> 版本鎖定理由：Prisma 6 允許把 `url` / `directUrl` 直接寫在 schema 的
> `datasource` block；Prisma 7 移除了這個能力，需改用 `prisma.config.ts`
> 搭配 driver adapter。為維持設定單純，本專案鎖定 Prisma 6。

---

## 命名慣例

- model 名稱：單數、PascalCase（`Tank`、`Creature`、`WaterLog`）
- 欄位名稱：camelCase（`userId`、`createdAt`、`observedSickOn`）
- 資料表對映：如需自訂表名用 `@@map`，欄位用 `@map`
- 每個 model 都應有：`id`（主鍵）、`createdAt`、`updatedAt`

## 型別慣例

- 主鍵 `id`：`String @id @default(cuid())`（除非有特別理由）
- 時間戳：`DateTime`，`createdAt` 用 `@default(now())`，`updatedAt` 用 `@updatedAt`
- 金額：用 `Decimal`（避免浮點誤差），不要用 `Float`
- 列舉：優先使用 Prisma `enum` 而非自由字串

## 關聯慣例

- 明確定義雙向 relation 與外鍵欄位
- 一律思考 `onDelete` 行為（例如刪除 Tank 時，其下的紀錄該 cascade 還是保留）
- 跨畫面共用的實體「只能有一個」model 定義，不可各畫面各自定義

---

## 已知的領域概念（供推導參考，非最終定案）

以下是這個海水缸領域常見的實體，Agent 可據此推導，但最終 model 以綜覽
所有畫面後的結果為準：

- **Tank（缸）**：一位使用者可有多個缸
- **Creature（生物 / 生體）**：屬於某個缸；有存活狀態、價格、加入日期等
- **WaterLog（水質紀錄）**：屬於某個缸；記錄 pH、鹽度、各項元素數值與時間
- **Maintenance（維護提醒）**：屬於某個缸；有週期、下次到期日等

### 死亡紀錄相關（先前設計已明確）
Creature 的死亡紀錄需要：
- 死因列舉：`disease` / `water_quality` / `predation` / `jumped` / `starvation` / `unknown`
- `observedSickOn`（觀察到生病的日期，可為 null）
- 死亡日期欄位

### 定價原則（先前設計已明確）
每隻生物的價值（總成本 / 存活價值 / 死亡價值）應由 `price + status`
**動態計算**，不要在資料庫裡重複儲存衍生欄位。

---

## 這份指引的邊界

- 上面的領域概念是「起點」，不是「終點」。Agent 必須綜覽 Epic 底下所有
  子 issue 的實際畫面，補齊真正需要的 model 與欄位。
- 任何結構性決策（新增 model、改 relation、改型別）都屬高風險，
  由 Agent 提草稿、人類定案。