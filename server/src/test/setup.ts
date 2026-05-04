import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

export async function resetDatabase(): Promise<void> {
  const tablenames = await prisma.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename FROM pg_tables WHERE schemaname='public'`

  for (const { tablename } of tablenames) {
    if (tablename === "_prisma_migrations") continue
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "public"."${tablename}" CASCADE;`,
    )
  }
}

export { prisma as testPrisma }
