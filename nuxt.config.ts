// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({

  modules: ['@nuxt/ui', '@nuxt/eslint'],
  devtools: { enabled: true },

  css: ['~/assets/css/main.css'],
  compatibilityDate: '2026-07-27',

  typescript: {
    strict: true,
  },

  eslint: {
    config: {
      stylistic: true,
    },
  },
})
