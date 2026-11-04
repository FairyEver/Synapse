import type { Prisma } from "@prisma/client"

/** Serialize asset writes with member removal and deletion in this team. */
export async function withTeamResourceLock(tx: Prisma.TransactionClient, teamId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`
  return rows.length > 0
}
