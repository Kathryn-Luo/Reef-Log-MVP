// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@nuxt/eslint'],

  devtools: { enabled: true },

  css: ['~/assets/css/main.css'],

  // 全站深色主題：html 上就掛好 .dark，避免載入初期閃一下淺色
  colorMode: {
    preference: 'dark',
    fallback: 'dark',
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
