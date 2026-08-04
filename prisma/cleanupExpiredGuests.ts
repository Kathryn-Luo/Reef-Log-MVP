import { PrismaClient } from '@prisma/client'
import { cleanupExpiredGuestUsers } from '../server/utils/guestCleanup.ts'

const prisma = new PrismaClient()

async function main() {
  const deletedUsers = await cleanupExpiredGuestUsers(prisma)

  console.info(`[guest-cleanup] Deleted ${deletedUsers} expired guest user(s).`)
}

main()
  .catch((error: unknown) => {
    console.error('[guest-cleanup] Failed to delete expired guest users.', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
