import { PrismaClient } from '@prisma/client'

// Nitro 在 dev 模式下會重複載入模組，用 globalThis 快取避免每次重整都開新連線
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (import.meta.dev) {
  globalForPrisma.prisma = prisma
}
