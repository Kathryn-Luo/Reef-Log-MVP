import type { Prisma, PrismaClient } from '@prisma/client'
import type { GuestSandboxResponse } from '#shared/types/guestSandbox'
import type { Timer } from './requestTiming'
import { TEMPLATE_USER } from '../../prisma/seedUser'
import { createTimer } from './requestTiming'

// 訪客沙盒的複製鏈（issue #66、Epic #47 第 6 節）。
//
// 「訪客登入」＝ 建一位新的 User + 複製一份示範資料掛在他名下，**不是**登入模板那一位。
// prisma/seed.ts 建的那一份因此是「永遠沒人登入的模板」（見 prisma/seedUser.ts）。
//
// 為什麼要整份複製而不是共用：示範缸能被任何人弄髒的話，下一位進站的人看到的就是那個
// ——這是作品集。（2026-08-01 起 production 與 preview 已是不同的 Neon 分支，弄髒不再會
// 波及 production；但「下一位訪客看到被弄髒的示範缸」這個理由本身不受影響。）也沒有走
// 「訪客唯讀」：ReefLog 是記錄工具，訪客不能記錄就等於看不到主要功能。
//
// Prisma Client 由呼叫端傳入，與 googleLogin.ts、currentContext.ts 同一個作法：
// 函式因此能在完全連不到資料庫的情況下測試。
//
// ⚠ issue #144 之後，複製**不再發生在訪客登入那次請求裡**。實測那一段要 11.5 秒，
// 佔 /auth/guest 全部耗時的 78%，而該路由的 302 是 handler 最後一行才發的。
// 現在的入口是下方的 ensureGuestSandbox()，由首頁在畫面已經看得到之後才呼叫。

/** 模板連同下層一次撈出來的形狀——複製鏈的每一層都在這裡。 */
const TEMPLATE_INCLUDE = {
  waterLogs: { include: { readings: true } },
  waterTargets: true,
  creatures: true,
  maintenanceTasks: { include: { completions: true } },
} as const

/**
 * 複製時一律丟掉的欄位。
 *
 * id 是重點：issue 明寫「新 id 一律由 cuid() 產生，不可沿用模板的固定 id」。seed 的每一列
 * 都是固定 id（seed-tank-main…），沿用的話第二位訪客不是撞主鍵就是直接寫進第一位的資料。
 * createdAt / updatedAt 同理——沙盒是現在才建的，不該宣稱自己是幾個月前建立的。
 */
const GENERATED_FIELDS = ['id', 'createdAt', 'updatedAt']

/**
 * 取出一列的「內容欄位」：丟掉主鍵、時間戳與外鍵，其餘照抄。
 *
 * 逐欄列舉會漏——schema 之後加一個欄位，複製鏈不會有任何測試變紅，訪客的沙盒就默默
 * 少了那一欄。反過來以「該丟的」為名單，新欄位預設會被帶上，這個方向的失敗看得見。
 *
 * 陣列一律略過：那是 include 進來的下層關聯，由呼叫端以 nested create 自己接上。
 * 外鍵也是同樣的理由——下層一律靠巢狀寫入取得新的父列 id，手上那個是模板的。
 *
 * 代價是回傳型別只能由呼叫端指定：欄位以「該丟的名單」決定，型別上就無從逐欄對應。
 * 這個 cast 是上面那個取捨的代價，而漏欄 / 型別不合最終仍會被資料庫的 schema 擋下來。
 */
function contentOf<T>(row: object, ...foreignKeys: string[]): T {
  return Object.fromEntries(
    Object.entries(row).filter(([key, value]) => !GENERATED_FIELDS.includes(key)
      && !foreignKeys.includes(key)
      && !Array.isArray(value)),
  ) as T
}

/**
 * 把模板使用者名下的缸整棵複製給 `targetUserId`，回傳複製了幾個缸。
 *
 * 全程只讀模板、只寫新的一份：模板上沒有任何 update / delete，所以訪客 A 之後怎麼改
 * 自己的沙盒，訪客 C 拿到的仍是乾淨的示範資料（Story ④）。
 *
 * 每個缸一次 nested create：缸與其下的水質、生物、保養在同一句寫入裡完成，中途失敗時
 * 不會留下半個缸。跨缸之間的一致性則由呼叫端的交易負責。
 *
 * 模板還沒 seed（全新的資料庫）時複製 0 個缸，訪客照樣進得去——首頁走既有的「還沒有缸」
 * 空狀態，而不是一頁 500。但那條路徑會留下一則警告：它同時也是「模板沒 seed」唯一的
 * 徵兆，靜默的話畫面上只是空的，server 端一個字都沒說（見下方 warnEmptyTemplate）。
 *
 * `timer` 是 issue #98 的分段計時（方向 A「先量再改」）。這裡切得比呼叫端細一層是
 * 因為「複製沙盒很慢」還不夠決定對策：慢在讀模板那一次巨大的 findMany，要改的是讀取
 * 那一側；慢在逐缸的 nested create，才輪得到方向 B（批次寫入）與 C（縮小模板）。
 * 而逐缸各自量得到，才分得出「三個缸平均慢」與「只有主缸慢」——後者做 C 也省不了多少。
 */
export async function copyTemplateSandbox(
  client: Prisma.TransactionClient,
  targetUserId: string,
  timer: Timer = createTimer(),
): Promise<number> {
  const tanks = await timer.measure('tx.sandbox.read', () => client.tank.findMany({
    where: { userId: TEMPLATE_USER.id },
    include: TEMPLATE_INCLUDE,
    // 缸的排序即「預設缸」的定義（schema.prisma 的 Tank.displayOrder），照著讀進來，
    // displayOrder 相同時複製出來的 createdAt 先後也才與模板一致。
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
  }))

  if (tanks.length === 0) {
    warnEmptyTemplate()

    return 0
  }

  for (const [index, tank] of tanks.entries()) {
    // Unchecked 版的 create input：缸的歸屬直接寫 userId 這個純量欄位，而不是
    // `user: { connect: … }`。訪客這一位是同一個交易裡剛建好的，沒有什麼好 connect 的。
    const data: Prisma.TankUncheckedCreateInput = {
      ...contentOf<Prisma.TankUncheckedCreateInput>(tank, 'userId'),
      userId: targetUserId,

      waterLogs: {
        create: tank.waterLogs.map(log => ({
          ...contentOf<Prisma.WaterLogUncheckedCreateWithoutTankInput>(log, 'tankId'),
          readings: {
            create: log.readings.map(
              reading => contentOf<Prisma.WaterReadingUncheckedCreateWithoutWaterLogInput>(reading, 'waterLogId'),
            ),
          },
        })),
      },

      waterTargets: {
        create: tank.waterTargets.map(
          target => contentOf<Prisma.WaterParameterTargetUncheckedCreateWithoutTankInput>(target, 'tankId'),
        ),
      },

      creatures: {
        create: tank.creatures.map(
          creature => contentOf<Prisma.CreatureUncheckedCreateWithoutTankInput>(creature, 'tankId'),
        ),
      },

      maintenanceTasks: {
        create: tank.maintenanceTasks.map(task => ({
          ...contentOf<Prisma.MaintenanceTaskUncheckedCreateWithoutTankInput>(task, 'tankId'),
          completions: {
            create: task.completions.map(
              completion => contentOf<Prisma.MaintenanceCompletionUncheckedCreateWithoutTaskInput>(completion, 'taskId'),
            ),
          },
        })),
      },
    }

    // 段落名以序號而不是缸名：缸名是示範資料的內容，會跟著 seed 一起變，
    // 拿它當 log 與 Server-Timing 的鍵，前後兩次量測就對不起來了。
    await timer.measure(`tx.sandbox.tank${index + 1}`, () => client.tank.create({ data }))
  }

  return tanks.length
}

/**
 * 複製沙盒的交易上限（毫秒）。
 *
 * Prisma 互動式交易的預設是 5 秒，而這裡要跑的是「模板有幾個缸就幾句 nested create」，
 * 每一句底下又是數十筆 insert。實測整段 11.5 秒（issue #144），5 秒必踩。
 *
 * 這兩個常數 #144 之前住在 guestLogin.ts，跟著複製一起搬過來：搬家不會讓工作量變小，
 * 留著預設值等於用 5 秒去做一件要 11 秒的事。
 */
const SANDBOX_TRANSACTION_TIMEOUT_MS = 30_000

/**
 * 等一條可用連線的上限（毫秒）。
 *
 * 與 timeout 是兩件事：timeout 管的是「交易開始之後能跑多久」，maxWait 管的是「交易
 * 開始之前能等多久」，預設只有 2 秒。Neon 是 serverless，連線吃緊時光是拿到連線就可能
 * 超過 2 秒——只放寬 timeout 會留下一個很難查的故障：交易根本還沒開始就失敗了，
 * 而錯誤訊息談的是交易。
 */
const SANDBOX_TRANSACTION_MAX_WAIT_MS = 10_000

/**
 * 補上這位使用者欠著的沙盒——沒欠就什麼都不做（issue #144）。
 *
 * #66 當初把複製放在 `/auth/guest` 裡，與建帳號同一個交易。那樣有一個很好的性質：
 * 要嘛「有帳號也有資料」，要嘛「兩者都沒有」，不會有中間態。代價是那 11.5 秒卡在
 * 302 之前，訪客只能對著登入頁乾等。
 *
 * 搬到這裡之後中間態真的出現了（有帳號、沒資料），所以那個保證要用別的方式拿回來：
 * **claim 與複製包在同一個交易裡**。
 *
 *   claim ＝ `updateMany({ where: { id, sandboxSeededAt: null } })`
 *
 *   - **搶得到才複製。** `sandboxSeededAt: null` 這個條件就是鎖本身，少了它這句 update
 *     永遠成功，冪等性整個失效。
 *   - **複製失敗 → 整個交易回滾 → claim 一起消失。** 這位使用者的 `sandboxSeededAt`
 *     仍然是 null，下次進站會再試一次。若把錯誤吞掉改回 `alreadySeeded: true`，
 *     交易會提交，他就被永久標記成「已備妥」而名下一個缸都沒有——#144 要避免的
 *     「半個帳號」正是這個。所以真正的失敗一律往外拋。
 *   - **「複製了 0 個」也算失敗。** copyTemplateSandbox 對空模板是回 0 而不是拋錯
 *     （訪客照樣要進得去），交易於是會正常提交、claim 留下——同樣是永久的半個帳號，
 *     只是從另一個方向進來。所以那一種在交易內部拋 EmptyTemplateError 讓它回滾，
 *     再於外層換成正常回應（畫面看到的是空狀態，不是一頁 500）。
 *   - **併發的第二次**卡在同一列的 row lock 上，等第一次提交後重新檢查 where，
 *     `sandboxSeededAt` 已經不是 null 了 → 0 筆 → 不複製。連點兩下、兩個分頁、
 *     重新整理，都只會有一份。
 *
 * 這支函式對「這位是不是訪客」沒有意見：Google 使用者建立當下 `sandboxSeededAt`
 * 就填上了現在（見 googleLogin.ts），claim 一律搶不到，於是自動什麼都不做。
 * 判斷因此只有一個地方（那個欄位），不必在這裡再問一次 provider。
 */
class EmptyTemplateError extends Error {}

export async function ensureGuestSandbox(
  client: PrismaClient,
  userId: string,
  timer: Timer = createTimer(),
): Promise<GuestSandboxResponse> {
  try {
    return await client.$transaction(
      async (tx) => {
        const claim = await tx.user.updateMany({
          where: { id: userId, sandboxSeededAt: null },
          data: { sandboxSeededAt: new Date() },
        })

        if (claim.count === 0) {
          return { copied: 0, alreadySeeded: true }
        }

        // 已經有缸卻還沒被標記過——只補標記，**不要再複製一份**。
        //
        // 這是 migration 回填的第二道防線。回填只涵蓋「執行當下已存在的列」，而
        // `prisma migrate deploy` 跑在 build 開始時、新的 bundle 要等 build 跑完才
        // 服務流量：那幾分鐘內由舊程式碼建立的訪客會**帶著完整的沙盒**而欄位是 null
        // （舊的 client 不認得那一欄）。少了這一條，他之後只要看到一次空清單就會被
        // 複製第二份，缸與生物直接變兩倍。
        if (await timer.measure('tx.sandbox.existing', () => tx.tank.count({ where: { userId } })) > 0) {
          return { copied: 0, alreadySeeded: true }
        }

        const copied = await copyTemplateSandbox(tx, userId, timer)

        // 模板一個缸都沒有——**不能讓 claim 留下來**。
        //
        // copyTemplateSandbox 對空模板是回 0 而不是拋錯（訪客照樣要進得去），
        // 所以交易會正常提交，這位使用者從此被標記成「沙盒已備妥」而名下沒有資料。
        // 之後人類跑了 `pnpm db:seed` 也救不回來：claim 再也搶不到。
        // #78 已經真的發生過一次「模板名下沒有缸」，那時的徵兆同樣只有畫面是空的。
        //
        // 拋錯讓交易回滾，sandboxSeededAt 回到 null，下次進站會再試一次。
        // 這個錯誤在下面被接住換成正常回應——使用者看到的是空狀態，不是一頁 500。
        if (copied === 0) {
          throw new EmptyTemplateError()
        }

        return { copied, alreadySeeded: false }
      },
      {
        timeout: SANDBOX_TRANSACTION_TIMEOUT_MS,
        maxWait: SANDBOX_TRANSACTION_MAX_WAIT_MS,
      },
    )
  }
  catch (cause) {
    // 只接住「模板是空的」這一種。其餘（連線斷、交易逾時）照樣往外拋——
    // 那些要讓呼叫端知道，畫面才有失敗提示與重試可給。
    if (!(cause instanceof EmptyTemplateError)) {
      throw cause
    }

    // alreadySeeded 為 false ＝「還欠著」，與資料庫此刻的狀態一致（claim 已回滾）
    return { copied: 0, alreadySeeded: false }
  }
}

/**
 * 模板名下一個缸都沒有——訪客會拿到空沙盒。
 *
 * 這不是錯誤（全新的資料庫本來就是這樣，訪客也照樣要進得去），所以不拋、不擋，
 * 只留一則 warn。但它值得留，因為**畫面上看不出差別**：使用者看到的是「還沒有缸」的
 * 正常空狀態，跟真的沒有缸長得一模一樣。
 *
 * 實際踩過一次：#78 merge 之後 preview 上按訪客按鈕進去是空的，而那個資料庫是在
 * #72（示範資料改掛模板使用者）之前 seed 的，缸還掛在舊的 seed-user-kathryn 名下。
 * 當時 server 端完全沒有線索，只能從程式碼一路往回推。
 *
 * 訊息刻意寫上 userId 與該跑的指令：看 log 的人要能直接知道下一步做什麼。
 */
function warnEmptyTemplate(): void {
  console.warn(
    `[auth] 模板使用者（${TEMPLATE_USER.id}）名下沒有任何缸，訪客拿到的會是空沙盒。`
    + ' 這個資料庫可能沒跑過 seed，或示範資料還掛在改名前的舊使用者名下——請對它執行 `pnpm db:seed`。',
  )
}
