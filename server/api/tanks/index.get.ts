import type { TankOption } from '#shared/types/home'

// screen-1 頁首的缸切換選單。清單的第一個即為預設缸（見 listTankOptions 的註解）。
export default defineEventHandler(async (): Promise<{ tanks: TankOption[] }> => {
  const user = await getCurrentUser(prisma)

  if (!user) {
    return { tanks: [] }
  }

  return { tanks: await listTankOptions(prisma, user.id) }
})
