import { SESSION_MAX_AGE_SECONDS } from './server/utils/session'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@nuxt/eslint', 'nuxt-auth-utils'],

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
