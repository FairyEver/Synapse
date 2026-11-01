import { randomInt } from "node:crypto"
import type { Prisma, PrismaClient } from "@prisma/client"

type SystemAvatarClient = Pick<PrismaClient, "systemAvatar"> | Prisma.TransactionClient

export type SelectedSystemAvatar = {
  readonly id: string
  readonly publicUrl: string
}

export async function selectRandomSystemAvatar(
  client: SystemAvatarClient,
  excludeId?: string | null,
): Promise<SelectedSystemAvatar | null> {
  const where = excludeId ? { id: { not: excludeId } } : undefined
  const count = await client.systemAvatar.count({ where })
  if (count === 0) return null

  const rows = await client.systemAvatar.findMany({
    where,
    orderBy: { sortOrder: "asc" },
    skip: randomInt(count),
    take: 1,
    select: { id: true, publicUrl: true },
  })
  return rows[0] ?? null
}
