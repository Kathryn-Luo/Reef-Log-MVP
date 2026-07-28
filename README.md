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
