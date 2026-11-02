import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import type { PokerRollStats, PokerRollTotals } from "@synapse/shared/game-contracts"
import type { RoomContext } from "./poker.service"

interface StatsRow {
  hand: PokerRollTotals
  room: PokerRollTotals
  players: { userId: string; handCount: number; handPaid: number; count: number; paid: number }[]
}
/** One room-scoped statement sees hot and immutable cold data in the same snapshot. */
export async function projectRollStats(c: RoomContext, handId: string | null, seats: readonly { seatNo: number; userId: string }[]): Promise<PokerRollStats> {
  const tracked = [...new Set(seats.map(seat => seat.userId))]
  const [row] = await c.tx.$queryRaw<StatsRow[]>(Prisma.sql`
    WITH records AS (
      SELECT r."id", r."handId", r."userId", r."data", 0 AS priority
      FROM "GamePokerRoll" r
      WHERE r."roomId"=${c.room.id}
      UNION ALL
      SELECT r->>'id', r->>'handId', r->>'userId', r->'data', 1
      FROM "GamePokerHandArchive" a
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a."data"->'rolls', '[]'::jsonb)) r
      WHERE a."roomId"=${c.room.id}
    ), unique_rolls AS (
      SELECT DISTINCT ON ("id") * FROM records ORDER BY "id", priority
    ), players AS (
      SELECT "userId",
        count(*)::float8 AS count, sum(("data"->>'fee')::bigint)::float8 AS paid,
        (count(*) FILTER (WHERE "handId"=${handId}))::float8 AS "handCount",
        COALESCE(sum(("data"->>'fee')::bigint) FILTER (WHERE "handId"=${handId}), 0)::float8 AS "handPaid"
      FROM unique_rolls GROUP BY "userId"
    ), tracked AS (
      SELECT * FROM players WHERE ${tracked.length ? Prisma.sql`"userId" IN (${Prisma.join(tracked)})` : Prisma.sql`FALSE`} ORDER BY "userId" LIMIT 10
    )
    SELECT jsonb_build_object('players', count(*) FILTER (WHERE "handCount">0), 'count', COALESCE(sum("handCount"),0), 'paid', COALESCE(sum("handPaid"),0)) AS hand,
      jsonb_build_object('players', count(*), 'count', COALESCE(sum(count),0), 'paid', COALESCE(sum(paid),0)) AS room,
      COALESCE((SELECT jsonb_agg(to_jsonb(tracked) ORDER BY "userId") FROM tracked), '[]'::jsonb) AS players
    FROM players LIMIT 1
  `)
  if (!row) throw new Error("无法读取房间换牌统计。")
  return {
    hand: row.hand, room: row.room,
    seats: seats.map(seat => {
      const player = row.players.find(player => player.userId === seat.userId)
      return { seatNo: seat.seatNo, key: createHash("sha256").update(JSON.stringify([c.room.id, seat.userId])).digest("hex"),
        hand: { count: player?.handCount ?? 0, paid: player?.handPaid ?? 0 }, room: { count: player?.count ?? 0, paid: player?.paid ?? 0 } }
    }),
  }
}
