import { SESSION_MAX_AGE_SECONDS } from './server/utils/session'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@nuxt/eslint', 'nuxt-auth-utils'],

  // SPA，不做伺服器端渲染（issue #84）。
  //
  // 這個 App 每一頁都要登入，SSR 能先送出的只是「等資料」的骨架；#67 之後爬蟲爬 `/`
  // 一律落在登入頁，SEO 也拿不到好處。而它有實際成本：SSR 那一次請求是**伺服器代替
  // 使用者**發的，瀏覽器那張 cookie 不會自動跟著走，於是伺服器端的 `$fetch` 打自己的
  // API 時是「沒有身分」的：
  //   - 在 401 之前——首頁拿到空清單，已登入的人重新整理會看到「還沒有缸」的空狀態
  //   - 在 401 之後（#68）——攔截器導去 /login，middleware 從 cookie 讀得到 session
  //     又導回 /，變成無限導向
  //
  // 補 `useRequestHeaders(['cookie'])` 只擋得住今天這一支，下一個忘記轉送的地方還是會
  // 踩到。關掉 SSR 是把產生這類 bug 的條件移除。未來打包成原生 App 時也不會有這一層。
  //
  // ⚠ 這不是 static export：server/api/** 與 server/routes/auth/** 仍然由 Nitro 提供，
  // preset 維持 'vercel'（見下）。改變的只有「頁面由誰渲染」。
  ssr: false,

  devtools: { enabled: true },

  css: ['~/assets/css/main.css'],

  // 全站深色主題：html 上就掛好 .dark，避免載入初期閃一下淺色
  colorMode: {
    preference: 'dark',
    fallback: 'dark',
  },

  // 密封 cookie session（#64）。這裡刻意只放「不是機密」的那一半：
  // password 由 NUXT_SESSION_PASSWORD 提供、client id / secret 由 NUXT_OAUTH_GOOGLE_*
  // 提供，三者都由人類設定，不寫進版控（見 .env.example）。
  runtimeConfig: {
    session: {
      // cookie 自己的存活時間，對齊 payload 裡的 exp。
      // 不設的話會變成瀏覽器關掉就消失的 session cookie，「登入一次就記得我」不成立。
      maxAge: SESSION_MAX_AGE_SECONDS,
    },
  },

  future: {
    compatibilityVersion: 4,
  },

  compatibilityDate: '2026-07-28',

  // Prisma 6 為非 edge 寫法，preset 必須為 Node（非 vercel-edge）
  nitro: {
    preset: 'vercel',
  },

  typescript: {
    strict: true,
    typeCheck: false,
  },

  eslint: {
    config: {
      stylistic: true,
    },
  },
})
