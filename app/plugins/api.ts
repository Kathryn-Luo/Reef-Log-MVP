import { isUnauthorizedStatus, resolveAuthRedirect } from '#shared/utils/routeGuard'

// 頁面呼叫 API 的統一入口（issue #67 的 Story ⑤）。
//
// 為什麼要有這一層：session 可能在畫面開著的時候過期，那時 middleware 早就跑完了，
// 只有請求本身知道「已經不算登入了」。沒有這個攔截器的話，畫面會停在 issue 說的
// 「一直失敗」的狀態——每個操作都失敗，卻沒有任何一步把人帶去重新登入。
//
// 為什麼是 plugin 而不是逐頁 try/catch：401 是整個 App 共通的一件事，
// 逐頁處理的話，漏掉的那一頁就是使用者卡住的那一頁。頁面一律改用 $api，
// 這件事由 route-guard-wiring.test.ts 守著。
export default defineNuxtPlugin((nuxtApp) => {
  const { session } = useUserSession()
  const router = useRouter()

  // 型別要寫出來：`$api` 會被掛回 NuxtApp 上，而攔截器裡的 navigateTo 又讀得到
  // NuxtApp——不標註的話 TypeScript 會繞回自己身上，推不出型別（TS7022）。
  const api: typeof $fetch = $fetch.create({
    async onResponseError({ response }): Promise<void> {
      if (!isUnauthorizedStatus(response.status)) {
        return
      }

      // server 已經說了這張 cookie 不算數，前端這一份也要跟著失效。
      // 少了這一步，導到 /login 之後 middleware 會以為人還登入著，
      // 立刻又把他推回首頁——兩邊互相導向，畫面就在中間彈來彈去。
      session.value = null

      const redirect = resolveAuthRedirect({
        path: router.currentRoute.value.path,
        signedIn: false,
      })

      if (!redirect) {
        return
      }

      // runWithContext：這裡是 fetch 的回呼，Nuxt 的 context 在 await 之後已經斷了，
      // 直接呼叫 navigateTo 會拿不到 nuxt app 實例。
      await nuxtApp.runWithContext(() => navigateTo(redirect, { replace: true }))
    },
  })

  return {
    provide: { api },
  }
})
