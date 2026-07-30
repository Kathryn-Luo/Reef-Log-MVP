// ReefLog — 開發 / preview 用的示範資料。
//
// 內容對齊 Epic #1 的 screen-1 截圖：一打開 preview 就是截圖的樣子，
// 首頁的每一條驗收條件都看得到對應的資料（見 #9）。
//
// 冪等：所有列都用固定 id upsert，重跑不會長出第二份資料。
// 時間相關的欄位（水質的 measuredAt、生病的 observedSickOn）刻意相對「現在」計算，
// 重跑會刷新——展示用的資料要一直看起來是「剛剛量的」。
//
// 執行：pnpm db:seed（Node 22 原生跑 .ts，不需要額外的 TS runner）

import { PrismaClient } from '@prisma/client'
import { upsertTemplateUser } from './seedUser.ts'

const prisma = new PrismaClient()

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const now = new Date()

/** @db.Date 欄位固定用 UTC 的 YYYY-MM-DD，與 server/utils/homeData.ts 的 toDateOnly 同一個基準 */
function dateOnly(value: Date): Date {
  return new Date(value.toISOString().slice(0, 10))
}

const TANK_ID = 'seed-tank-main'
const WATER_LOG_ID = 'seed-waterlog-latest'

async function main() {
  // 這一份示範資料的主人是「模板使用者」——沒有 email、不可被登入、永遠沒人使用它，
  // 只是訪客沙盒複製資料時的來源。詳見 prisma/seedUser.ts。
  const user = await upsertTemplateUser(prisma)

  // screen-1 頁首：「主缸 · 4 尺」／「SPS MIXED · 420L」／左側色塊
  const tank = await prisma.tank.upsert({
    where: { id: TANK_ID },
    update: {},
    create: {
      id: TANK_ID,
      userId: user.id,
      name: '主缸',
      sizeSpec: '4 尺',
      volumeLiters: 420,
      setupType: 'SPS MIXED',
      colorHex: '#2DD4BF',
      startedOn: dateOnly(new Date(now.getTime() - 600 * DAY)),
      displayOrder: 0,
    },
  })

  // 第二個缸：頁首的 ∨ 要有東西可切換才看得出行為（#9 的第二條驗收條件）
  await prisma.tank.upsert({
    where: { id: 'seed-tank-nano' },
    update: {},
    create: {
      id: 'seed-tank-nano',
      userId: user.id,
      name: '小缸',
      sizeSpec: '2 尺',
      volumeLiters: 90,
      setupType: 'LPS',
      colorHex: '#F59E0B',
      startedOn: dateOnly(new Date(now.getTime() - 200 * DAY)),
      displayOrder: 1,
    },
  })

  // 已封存的缸：驗證切換選單「不」顯示它
  await prisma.tank.upsert({
    where: { id: 'seed-tank-archived' },
    update: {},
    create: {
      id: 'seed-tank-archived',
      userId: user.id,
      name: '舊缸',
      sizeSpec: '3 尺',
      volumeLiters: 180,
      setupType: 'FOWLR',
      colorHex: '#94A3B8',
      displayOrder: 2,
      archivedAt: new Date(now.getTime() - 30 * DAY),
    },
  })

  // ── 水質 ────────────────────────────────────────────────
  //
  // screen-2 儀表板右側標示的區間：7–9 / 380–450 / 1250–1350 / 2–10 / .02–.10 / 1.024–1.027。
  //
  // 鹽度刻意「不」設定，讓應用層的預設區間也走得到（schema.prisma 的
  // WaterParameterTarget 註解要求那條路徑存在）——它的預設值正好就是 1.024–1.027，
  // preview 上看到的區間文字仍與截圖一致。
  const targets = [
    { parameter: 'KH', minValue: 7, maxValue: 9 },
    { parameter: 'CA', minValue: 380, maxValue: 450 },
    { parameter: 'MG', minValue: 1250, maxValue: 1350 },
    { parameter: 'NO3', minValue: 2, maxValue: 10 },
    { parameter: 'PO4', minValue: 0.02, maxValue: 0.1 },
  ] as const

  for (const target of targets) {
    await prisma.waterParameterTarget.upsert({
      where: { tankId_parameter: { tankId: tank.id, parameter: target.parameter } },
      update: { minValue: target.minValue, maxValue: target.maxValue },
      create: { tankId: tank.id, ...target },
    })
  }

  // screen-1 的「· 4h」與橘色徽章「2 需注意」：
  // Mg 1180 低於 1250（偏低），NO₃ 12 高於 10（偏高），其餘四項正常。
  const waterLog = await prisma.waterLog.upsert({
    where: { id: WATER_LOG_ID },
    update: { measuredAt: new Date(now.getTime() - 4 * HOUR) },
    create: {
      id: WATER_LOG_ID,
      tankId: tank.id,
      measuredAt: new Date(now.getTime() - 4 * HOUR),
    },
  })

  const readings = [
    { parameter: 'KH', value: 7.8 },
    { parameter: 'CA', value: 412 },
    { parameter: 'MG', value: 1180 },
    { parameter: 'NO3', value: 12 },
    { parameter: 'PO4', value: 0.04 },
    { parameter: 'SALINITY', value: 1.026 },
  ] as const

  for (const reading of readings) {
    await prisma.waterReading.upsert({
      where: {
        waterLogId_parameter: { waterLogId: waterLog.id, parameter: reading.parameter },
      },
      update: { value: reading.value },
      create: { waterLogId: waterLog.id, ...reading },
    })
  }

  // 前幾筆歷史記錄：screen-2 的迷你趨勢線、screen-3 的歷史列表與 screen-4 的趨勢折線
  // 都要有東西可畫。首頁的摘要列只看最新一筆，這些不影響「· 4h」。
  for (const daysAgo of [4, 11, 18, 25]) {
    const id = `seed-waterlog-${daysAgo}d`
    const measuredAt = new Date(now.getTime() - daysAgo * DAY)

    const log = await prisma.waterLog.upsert({
      where: { id },
      update: { measuredAt },
      create: { id, tankId: tank.id, measuredAt },
    })

    // 讓趨勢看得出走勢：Mg 一路下滑、NO₃ 一路上升，正好解釋最新一筆的兩個異常。
    // 六個測項都給，screen-2 的六列才都畫得出迷你趨勢線
    // （少於兩筆讀數的測項不會硬畫一條假的線，見 shared/utils/sparkline.ts）。
    const history = [
      { parameter: 'KH', value: 7.8 + (daysAgo % 3) * 0.1 },
      { parameter: 'CA', value: 412 + (daysAgo % 4) * 5 },
      { parameter: 'MG', value: 1180 + daysAgo * 4 },
      { parameter: 'NO3', value: 12 - daysAgo * 0.3 },
      { parameter: 'PO4', value: 0.04 - daysAgo * 0.0008 },
      { parameter: 'SALINITY', value: 1.026 + (daysAgo % 3) * 0.0005 },
    ] as const

    for (const reading of history) {
      await prisma.waterReading.upsert({
        where: { waterLogId_parameter: { waterLogId: log.id, parameter: reading.parameter } },
        update: { value: reading.value },
        create: { waterLogId: log.id, ...reading },
      })
    }
  }

  // ── 生物：魚 5、珊瑚 6、其他 1，共 12 隻 ──────────────────
  //
  // 涵蓋 #9 全部的卡片樣態：存活 / 生病 / 死亡三種狀態，以及兩隻同名的
  // 「公子小丑」（首頁合併為「公子小丑 ×2」）。
  const creatures = [
    // 魚 ×5
    {
      id: 'seed-creature-01',
      name: '藍倒吊',
      scientificName: 'Paracanthurus hepatus',
      category: 'FISH',
      subCategory: '倒吊',
      addedOn: 240,
      price: 1800,
      status: 'ALIVE',
    },
    {
      id: 'seed-creature-02',
      name: '公子小丑',
      scientificName: 'Amphiprion ocellaris',
      category: 'FISH',
      subCategory: '小丑',
      addedOn: 260,
      price: 350,
      status: 'ALIVE',
    },
    {
      id: 'seed-creature-03',
      name: '公子小丑',
      scientificName: 'Amphiprion ocellaris',
      category: 'FISH',
      subCategory: '小丑',
      addedOn: 260,
      price: 350,
      status: 'ALIVE',
    },
    {
      id: 'seed-creature-04',
      name: '火焰仙',
      scientificName: 'Centropyge loriculus',
      category: 'FISH',
      subCategory: '神仙',
      addedOn: 150,
      price: 3200,
      status: 'SICK',
      ailment: '白點',
      observedSickOn: 3,
    },
    {
      id: 'seed-creature-05',
      name: '六線龍',
      scientificName: 'Pseudocheilinus hexataenia',
      category: 'FISH',
      subCategory: '龍魚',
      addedOn: 250,
      price: 900,
      status: 'DEAD',
      observedSickOn: 74,
      diedOn: 70,
      causeOfDeath: 'JUMPED',
      deathNote: '半夜跳出主缸，早上發現已乾。之後加裝上蓋防跳網。',
    },

    // 珊瑚 ×6
    {
      id: 'seed-creature-06',
      name: '榔頭珊瑚',
      scientificName: 'Euphyllia ancora',
      category: 'CORAL',
      subCategory: 'LPS',
      addedOn: 210,
      price: 1500,
      status: 'ALIVE',
    },
    {
      id: 'seed-creature-07',
      name: '火炬珊瑚',
      scientificName: 'Euphyllia glabrescens',
      category: 'CORAL',
      subCategory: 'LPS',
      addedOn: 180,
      price: 2200,
      status: 'ALIVE',
    },
    {
      id: 'seed-creature-08',
      name: '紐扣珊瑚',
      scientificName: 'Zoanthus sp.',
      category: 'CORAL',
      subCategory: '軟體',
      addedOn: 300,
      price: 600,
      status: 'ALIVE',
    },
    {
      id: 'seed-creature-09',
      name: '皮革軟珊瑚',
      scientificName: 'Sarcophyton sp.',
      category: 'CORAL',
      subCategory: '軟體',
      addedOn: 320,
      price: 800,
      status: 'ALIVE',
    },
    {
      id: 'seed-creature-10',
      name: '鹿角珊瑚',
      scientificName: 'Acropora sp.',
      category: 'CORAL',
      subCategory: 'SPS',
      addedOn: 95,
      price: 2800,
      status: 'ALIVE',
    },
    {
      id: 'seed-creature-11',
      name: '太陽花珊瑚',
      scientificName: 'Goniopora sp.',
      category: 'CORAL',
      subCategory: 'LPS',
      addedOn: 130,
      price: 1200,
      status: 'SICK',
      ailment: '組織退縮',
      observedSickOn: 6,
    },

    // 其他 ×1
    {
      id: 'seed-creature-12',
      name: '白襪清潔蝦',
      scientificName: 'Lysmata amboinensis',
      category: 'OTHER',
      subCategory: '蝦',
      addedOn: 190,
      price: 450,
      status: 'ALIVE',
    },
  ] as const

  for (const creature of creatures) {
    const data = {
      tankId: tank.id,
      name: creature.name,
      scientificName: creature.scientificName,
      category: creature.category,
      subCategory: creature.subCategory,
      addedOn: dateOnly(new Date(now.getTime() - creature.addedOn * DAY)),
      price: creature.price,
      status: creature.status,
      ailment: 'ailment' in creature ? creature.ailment : null,
      observedSickOn: 'observedSickOn' in creature
        ? dateOnly(new Date(now.getTime() - creature.observedSickOn * DAY))
        : null,
      diedOn: 'diedOn' in creature
        ? dateOnly(new Date(now.getTime() - creature.diedOn * DAY))
        : null,
      causeOfDeath: 'causeOfDeath' in creature ? creature.causeOfDeath : null,
      deathNote: 'deathNote' in creature ? creature.deathNote : null,
    }

    await prisma.creature.upsert({
      where: { id: creature.id },
      update: data,
      create: { id: creature.id, ...data },
    })
  }

  // ── 保養提醒（screen-7）─────────────────────────────────
  const tasks = [
    { id: 'seed-task-01', name: '換水 10%', intervalDays: 7, displayOrder: 0, lastDoneDaysAgo: 6 },
    { id: 'seed-task-02', name: '餵食', intervalDays: 1, displayOrder: 1, lastDoneDaysAgo: 0 },
    { id: 'seed-task-03', name: '洗前置棉', intervalDays: 7, displayOrder: 2, lastDoneDaysAgo: 4 },
    { id: 'seed-task-04', name: '折射計校正', intervalDays: 30, displayOrder: 3, lastDoneDaysAgo: 27 },
    { id: 'seed-task-05', name: '換活性碳', intervalDays: 60, displayOrder: 4, lastDoneDaysAgo: 12 },
  ] as const

  for (const task of tasks) {
    await prisma.maintenanceTask.upsert({
      where: { id: task.id },
      update: {},
      create: {
        id: task.id,
        tankId: tank.id,
        name: task.name,
        intervalDays: task.intervalDays,
        displayOrder: task.displayOrder,
        startOn: dateOnly(new Date(now.getTime() - 90 * DAY)),
      },
    })

    const completedAt = new Date(now.getTime() - task.lastDoneDaysAgo * DAY)
    const completedOn = dateOnly(completedAt)

    await prisma.maintenanceCompletion.upsert({
      where: { taskId_completedOn: { taskId: task.id, completedOn } },
      update: { completedAt },
      create: { taskId: task.id, completedAt, completedOn },
    })
  }

  const counts = {
    tanks: await prisma.tank.count(),
    waterLogs: await prisma.waterLog.count(),
    creatures: await prisma.creature.count(),
    tasks: await prisma.maintenanceTask.count(),
  }

  console.log('Seed 完成：', counts)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
