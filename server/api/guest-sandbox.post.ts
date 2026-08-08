import type { GuestSandboxResponse } from '#shared/types/guestSandbox'

// POST /api/guest-sandbox —— 補上這位使用者欠著的示範資料（issue #144）。
//
// 為什麼是 POST：它會寫入。GET 的話瀏覽器與爬蟲的預取就能觸發整份沙盒的複製，
// 而 /auth/guest 已經因為是 GET 而付過一次代價了（見 server/routes/auth/guest.get.ts）。
//
// 掛在 server/api/ 而不是 server/routes/：這一支是給前端 fetch 的端點，不是導向的終點。
//
// 「誰可以呼叫」與「要不要真的複製」都在 server/utils/authorization.ts 與
// guestSandbox.ts——這裡只負責接線、以及把計時送出去。

// issue #98：instance 的探針一定要在 handler 外面建立。建在裡面的話每個請求都是自己的
// 「第一次」，cold 永遠是 true。
const probeInstance = createInstanceProbe()

export default defineEventHandler(async (event): Promise<GuestSandboxResponse> => {
  // ⚠ 這一段計時是 #144 搬家之後**唯一**看得到那 11.5 秒的地方。
  //
  // 複製從 /auth/guest 搬過來之後，guest-login-timing.spec.ts 證明的是那幾段
  // 「不在登入請求裡」——但沒有任何東西證明它們在別的地方。少了這裡，#98 建起來的
  // 整套分段計時就只覆蓋剩下的 2.8 秒，而方向 B（批次寫入）與 C（縮小模板）要用的
  // 數字全部消失，那兩個方向就沒有依據可挑。
  const timer = createTimer()
  const instance = probeInstance()

  try {
    const result = await resolveGuestSandbox(prisma, await getCurrentUser(event), timer)

    if (!result.ok) {
      throw createError(result.error)
    }

    console.info(formatTimingLog('[auth] 補建訪客沙盒', timer, instance, {
      copied: result.value.copied,
      alreadySeeded: result.value.alreadySeeded,
    }))

    // 與 /auth/guest 同樣發兩個標頭：Server-Timing 到不了 preview 的客戶端
    // （Vercel 那一層會改寫它，見 guest.get.ts 的說明），E2E 讀的是自訂的那一個。
    const timing = formatServerTiming(timer, instance)

    setResponseHeader(event, 'Server-Timing', timing)
    setResponseHeader(event, 'X-Sandbox-Timing', timing)

    return result.value
  }
  catch (cause) {
    // 失敗那一次最需要數據——複製逾時的時候，人要知道它是卡在哪一段才逾時的。
    // 401 也會落在這裡，但它在任何查詢之前就回，段落是空的，不會混淆。
    console.error(formatTimingLog('[auth] 補建訪客沙盒失敗', timer, instance), cause)

    throw cause
  }
})
