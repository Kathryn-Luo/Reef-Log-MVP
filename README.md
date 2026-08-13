# ReefLog

海水缸記錄工具。開發規範見 [`CLAUDE.md`](./CLAUDE.md)。

## 技術棧

Nuxt 4 · Nuxt UI 4 · Tailwind CSS 4 · TypeScript · Prisma 6 + Neon · Vitest · Playwright

## 開發

```bash
npm install
cp .env.example .env   # 填入 Neon 的 DATABASE_URL / DIRECT_URL
npm run dev
```

各變數的用途、取得方式與「少了它會怎樣」都寫在 [`.env.example`](./.env.example) 裡。
其中 `BLOB_READ_WRITE_TOKEN` 是圖片上傳（頭像 #166、生物照片 #154）用的 Vercel Blob
憑證：**沒設定的話上傳會失敗，其餘功能一律不受影響**，所以只有要在本機試上傳時才需要。

## 常用指令

| 指令 | 說明 |
|------|------|
| `npm run dev` | 啟動開發伺服器 |
| `npm run build` | `prisma generate` + `nuxt build` |
| `npm run lint` / `lint:fix` | ESLint 檢查 / 自動修正 |
| `npm run typecheck` | Nuxt 型別檢查 |
| `npm test` | Vitest 單元測試 |
| `npm run test:e2e` | Playwright E2E（預設打本機 dev server，CI 上打 Vercel Preview URL） |
| `npm run prisma:migrate` | 建立 /套用 migration |
| `npm run prisma:studio` | 開啟 Prisma Studio |
