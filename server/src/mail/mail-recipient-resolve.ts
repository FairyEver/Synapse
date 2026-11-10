import { Prisma } from "@prisma/client"

type RecipientMatch = { nickname: string; userId: string; contactEmail: string | null }
type RecipientResolution =
  | (RecipientMatch & { status: "matched" })
  | { nickname: string; status: "not_found" | "ambiguous" }

export async function resolveRecipientNicknames(
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  userId: string,
  nicknames: string[],
): Promise<RecipientResolution[]> {
  const requested = Prisma.join([...new Set(nicknames)].map(nickname => Prisma.sql`(${nickname}::text)`))
  // EXISTS keeps one row per user, even when several teams are shared.
  const rows = await db.$queryRaw<RecipientMatch[]>(Prisma.sql`
    WITH requester_teams AS (
      SELECT "teamId" FROM "TeamMembership" WHERE "userId" = ${userId}
    )
    SELECT requested.nickname, candidate."userId", candidate."contactEmail"
    FROM (VALUES ${requested}) AS requested(nickname)
    CROSS JOIN LATERAL (
      SELECT u.id AS "userId", u."contactEmail"
      FROM "User" u
      WHERE u.nickname COLLATE "C" = requested.nickname AND u.status = 'active'
        AND EXISTS (
          SELECT 1 FROM "TeamMembership" membership
          JOIN requester_teams team ON team."teamId" = membership."teamId"
          WHERE membership."userId" = u.id
        )
      LIMIT 2
    ) candidate
  `)

  const matches = new Map<string, RecipientMatch | null>()
  for (const row of rows) {
    matches.set(row.nickname, matches.has(row.nickname) ? null : row)
  }
  return nicknames.map(nickname => {
    const match = matches.get(nickname)
    if (match === undefined) return { nickname, status: "not_found" }
    if (match === null) return { nickname, status: "ambiguous" }
    return { ...match, status: "matched" }
  })
}
