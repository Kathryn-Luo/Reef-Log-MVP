import type { PrismaClient } from '@prisma/client'
import type { TankOption } from '#shared/types/home'
import type { CreateTankInput } from '#shared/types/tank'
import { toTankOption } from './homeData'

// 建立缸（issue #46）。本專案第一個寫入操作。
//
// Prisma Client 由呼叫端傳入（server/utils/prisma.ts 的實例），與 homeData.ts、
// currentContext.ts 同一個作法：函式因此能在完全連不到資料庫的情況下測試。

/**
 * 在指定使用者名下建立一個缸，回傳頁首 / 缸切換選單需要的欄位。
 *
 * displayOrder 取「該使用者目前的缸數」，新缸因此排在切換選單的最後
 * （schema.prisma 的 Tank.displayOrder：ORDER BY displayOrder ASC, createdAt ASC）。
 * 計數刻意「不」排除已封存的缸：封存過的缸仍佔著它當初的 displayOrder，
 * 只算未封存的會發出重複的序號，排序就退回 createdAt 這個 tiebreaker，
 * 新缸反而插到舊缸前面。
 */
export async function createTank(
  client: PrismaClient,
  userId: string,
  input: CreateTankInput,
): Promise<TankOption> {
  const displayOrder = await client.tank.count({ where: { userId } })

  const tank = await client.tank.create({
    data: {
      userId,
      name: input.name,
      sizeSpec: input.sizeSpec,
      volumeLiters: input.volumeLiters,
      setupType: input.setupType,
      colorHex: input.colorHex,
      // Tank.startedOn 是 @db.Date，只存日期。釘在 UTC 零時而不是本地零時，
      // 免得 UTC+8 的使用者選 11/12 卻被記成 11/11。
      startedOn: input.startedOn === null ? null : new Date(`${input.startedOn}T00:00:00.000Z`),
      displayOrder,
    },
  })

  return toTankOption(tank)
}
