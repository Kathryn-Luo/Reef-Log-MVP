import type { Prisma } from '@prisma/client'
import { TEMPLATE_USER } from '../../prisma/seedUser'

// 訪客沙盒的複製鏈（issue #66、Epic #47 第 6 節）。
//
// 「訪客登入」＝ 建一位新的 User + 複製一份示範資料掛在他名下，**不是**登入模板那一位。
// prisma/seed.ts 建的那一份因此是「永遠沒人登入的模板」（見 prisma/seedUser.ts）。
//
// 為什麼要整份複製而不是共用：示範缸能被任何人弄髒的話，下一位進站的人看到的就是那個
// ——這是作品集，而且 MVP 階段 production 與 preview 共用同一個 Neon 分支，弄髒是兩邊
// 一起髒。也沒有走「訪客唯讀」：ReefLog 是記錄工具，訪客不能記錄就等於看不到主要功能。
//
// Prisma Client 由呼叫端傳入（實際上是 resolveGuestLogin 開的交易），與 googleLogin.ts、
// currentContext.ts 同一個作法：函式因此能在完全連不到資料庫的情況下測試。

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
 */
export async function copyTemplateSandbox(
  client: Prisma.TransactionClient,
  targetUserId: string,
): Promise<number> {
  const tanks = await client.tank.findMany({
    where: { userId: TEMPLATE_USER.id },
    include: TEMPLATE_INCLUDE,
    // 缸的排序即「預設缸」的定義（schema.prisma 的 Tank.displayOrder），照著讀進來，
    // displayOrder 相同時複製出來的 createdAt 先後也才與模板一致。
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
  })

  if (tanks.length === 0) {
    warnEmptyTemplate()

    return 0
  }

  for (const tank of tanks) {
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

    await client.tank.create({ data })
  }

  return tanks.length
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
