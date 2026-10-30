import type { PokerStats, PokerAgentView } from "@synapse/shared/game-contracts"
import { Injectable } from "@nestjs/common"
import { Prisma, type GamePokerHandSummary } from "@prisma/client"
import { PokerService } from "./poker.service"
import { reject } from "./poker-error"
import { archiveData, type ArchivedHand } from "./poker-archive.service"
import { resolveRules, type PokerRules } from "./engine/rules"
@Injectable()
export class PokerReadService {
  constructor(private readonly poker: PokerService) {}
  async lobby(offset = 0, limit = 50, mode: "points" | "practice" = "points") {
    const rooms = await this.poker.prisma.gamePokerRoom.findMany({
      where: { status: { not: "closed" }, mode },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: limit + 1,
      select: {
        id: true,
        code: true,
        name: true,
        ownerUserId: true,
        mode: true,
        variant: true,
        maxSeats: true,
        buyIn: true,
        status: true,
        smallBlind: true,
        bigBlind: true,
      },
    })
    const seats = await this.poker.prisma.gamePokerSeat.groupBy({
      by: ["roomId"],
      where: { roomId: { in: rooms.map((r) => r.id) } },
      _count: true,
    })
    return {
      items: rooms.slice(0, limit).map((r) => ({
        roomCode: r.code,
        name: r.name,
        ownerUserId: r.ownerUserId,
        mode: r.mode as "points" | "practice",
        rules: resolveRules(r as unknown as Partial<PokerRules>),
        maxSeats: r.maxSeats,
        buyIn: r.buyIn,
        status: r.status,
        smallBlind: r.smallBlind,
        bigBlind: r.bigBlind,
        players: seats.find((s) => s.roomId === r.id)?._count ?? 0,
      })),
      nextOffset: rooms.length > limit ? offset + limit : null,
    }
  }
  async agents(userId: string): Promise<PokerAgentView[]> {
    const rows: PokerAgentView[] = []
    let cursorId: string | undefined
    for (;;) {
      const page = await this.poker.prisma.gamePokerAgent.findMany({
        where: { userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1000,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        select: { id: true, model: true, persona: true, currentVersionId: true, versionSeq: true },
      })
      rows.push(...page)
      if (page.length < 1000) return rows
      cursorId = page.at(-1)!.id
    }
  }
  async history(userId: string, offset = 0, limit = 50, mode: "points" | "practice" = "points") {
    const rows = await this.poker.prisma.$queryRaw<GamePokerHandSummary[]>`
      SELECT "id","roomId","handId","handNo","userId","seatNo","delta","result","holeCards","board","createdAt" FROM (
        SELECT "id","roomId","handId","handNo","userId","seatNo","delta","result","holeCards","board","createdAt" FROM "GamePokerHandSummary" WHERE "userId"=${userId} AND "mode"=${mode}
        UNION ALL
        SELECT summary->>'id',summary->>'roomId',summary->>'handId',(summary->>'handNo')::int,summary->>'userId',(summary->>'seatNo')::int,(summary->>'delta')::int,summary->>'result',summary->'holeCards',summary->'board',(summary->>'createdAt')::timestamp
        FROM "GamePokerHandArchive" archive CROSS JOIN LATERAL jsonb_array_elements(archive."data"->'summaries') AS entry(summary)
        WHERE archive."participantIds" @> ARRAY[${userId}]::text[] AND summary->>'userId'=${userId} AND COALESCE(summary->>'mode','points')=${mode}
      ) records ORDER BY "createdAt" DESC,"id" DESC LIMIT ${limit + 1} OFFSET ${offset}`
    const rooms = await this.poker.prisma.gamePokerRoom.findMany({
      where: { id: { in: rows.map((r) => r.roomId) } },
      select: { id: true, code: true, variant: true, smallBlind: true, bigBlind: true },
      take: limit + 1,
    })
    return {
      items: rows.slice(0, limit).map((r) => ({
        mode,
        handId: r.handId,
        roomCode: rooms.find((room) => room.id === r.roomId)!.code,
        rules: resolveRules(rooms.find((room) => room.id === r.roomId) as unknown as Partial<PokerRules>),
        handNo: r.handNo,
        seatNo: r.seatNo,
        delta: r.delta,
        result: r.result,
        hole: r.holeCards,
        board: r.board,
        createdAt: r.createdAt,
      })),
      nextOffset: rows.length > limit ? offset + limit : null,
    }
  }
  async detail(userId: string, code: string, handNo: number) {
    return this.poker.prisma.$transaction(
      async (tx) => {
        const room = await tx.gamePokerRoom.findUnique({ where: { code }, select: { id: true, mode: true } })
        if (!room) reject("POKER_ROOM_NOT_FOUND", "房间不存在。")
        const hot = await tx.gamePokerHand.findUnique({
          where: { roomId_handNo: { roomId: room.id, handNo } },
        })
        let hand: ArchivedHand["hand"],
          participants: ArchivedHand["seats"],
          actions: ArchivedHand["actions"]
        if (hot) {
          hand = hot
          participants = await tx.gamePokerHandSeat.findMany({
            where: { handId: hot.id },
            take: 10,
            orderBy: { seatNo: "asc" },
          })
          if (!participants.some((s) => s.userId === userId))
            reject("POKER_SEAT_NOT_FOUND", "只能读取本人参与的手牌。")
          actions = []
          let afterSeq = 0
          for (;;) {
            const page = await tx.gamePokerAction.findMany({
              where: { handId: hot.id, seq: { gt: afterSeq } },
              orderBy: { seq: "asc" },
              take: 1000,
            })
            actions.push(...page)
            if (page.length < 1000) break
            afterSeq = page.at(-1)!.seq
          }
        } else {
          const cold = await tx.gamePokerHandArchive.findUnique({
            where: { roomId_handNo: { roomId: room.id, handNo } },
          })
          if (!cold) reject("POKER_HAND_NOT_ACTIVE", "手牌不存在。")
          if (!cold.participantIds.includes(userId))
            reject("POKER_SEAT_NOT_FOUND", "只能读取本人参与的手牌。")
          const data = archiveData(cold.data)
          hand = data.hand
          participants = data.seats
          actions = data.actions
        }
        if (!participants.some((s) => s.userId === userId))
          reject("POKER_SEAT_NOT_FOUND", "只能读取本人参与的手牌。")
        const versionIds = [
          ...new Set(
            actions
              .filter((a) => a.userId === userId && a.personaVersionId)
              .map((a) => a.personaVersionId!),
          ),
        ]
        const versions: { id: string; versionNo: number; persona: string }[] = []
        for (let offset = 0; offset < versionIds.length; offset += 1000) {
          versions.push(
            ...(await tx.gamePokerAgentVersion.findMany({
              where: { id: { in: versionIds.slice(offset, offset + 1000) } },
              select: { id: true, versionNo: true, persona: true },
              take: 1000,
            })),
          )
        }
        const shown = Array.isArray(hand.showdownSeats) ? hand.showdownSeats : []
        return {
          mode: room.mode,
          rules: resolveRules((hand.rules ?? {}) as Partial<PokerRules>),
          handId: hand.id,
          handNo: hand.handNo,
          roomCode: code,
          board: hand.board,
          street: hand.street,
          result: hand.result,
          seats: participants.map((s) => ({
            seatNo: s.seatNo,
            displayName: s.displayName,
            participantKind: s.participantKind ?? "human",
            startingStack: s.startingStack,
            endingStack: s.endingStack,
            folded: s.folded,
            ...(s.userId === userId || (!s.folded && shown.includes(s.seatNo))
              ? { hole: s.holeCards }
              : {}),
          })),
          actions: actions.map((a) => ({
            seq: a.seq,
            seatNo: a.seatNo,
            street: a.street,
            action: a.action,
            amount: a.amount,
            potAfter: a.potAfter,
            isAuto: a.isAuto,
            actionSource: a.actionSource ?? (a.isAuto ? "timeout" : "mcp"),
            elapsedMs: a.elapsedMs,
            ...(a.userId === userId
              ? {
                  note: a.note,
                  personaVersion: versions.find((v) => v.id === a.personaVersionId)
                    ? {
                        versionNo: versions.find((v) => v.id === a.personaVersionId)!.versionNo,
                        persona: versions.find((v) => v.id === a.personaVersionId)!.persona,
                      }
                    : null,
                }
              : {}),
          })),
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    )
  }
  async stats(userId: string, roomCode?: string, mode?: "points" | "practice"): Promise<PokerStats> {
    if (!roomCode) return this.userStats(userId, mode ?? "points")
    return this.poker.withRoom(
      roomCode,
      async (c) => {
        if (!c.seats.some((s) => s.userId === userId))
          reject("POKER_SEAT_NOT_FOUND", "只能对比本人所在的牌桌。")
        if (mode && mode !== c.room.mode) reject("POKER_ILLEGAL_ACTION", "统计类型与房间不匹配。")
        const actualMode = c.room.mode === "practice" ? "practice" : "points"
        const own = await this.userStats(userId, actualMode)
        const comparison = await Promise.all(
          c.seats.filter((s) => s.participantKind !== "bot").map(async (seat) => ({
            seatNo: seat.seatNo,
            displayName: seat.displayName,
            isMe: seat.userId === userId,
            ...(await this.userStats(seat.userId, actualMode)),
          })),
        )
        return { ...own, comparison }
      },
      new Date(),
      false,
    )
  }
  private async userStats(userId: string, mode: "points" | "practice") {
    // Reconstruct each street's public contributions, including actual posted blinds.
    // An all-in is a raise only when its total exceeds the preceding table bet.
    const [s] = await this.poker.prisma.$queryRaw<
      {
        hands: number
        netProfit: number
        wins: number
        vpipHands: number
        pfrHands: number
        bets: number
        calls: number
      }[]
    >`
      WITH user_hands AS (
        SELECT "handId","roomId","delta","result","createdAt" FROM "GamePokerHandSummary" WHERE "userId"=${userId} AND "mode"=${mode}
        UNION ALL
        SELECT summary->>'handId',archive."roomId",(summary->>'delta')::int,summary->>'result',(summary->>'createdAt')::timestamp
        FROM "GamePokerHandArchive" archive CROSS JOIN LATERAL jsonb_array_elements(archive."data"->'summaries') AS entry(summary)
        WHERE archive."participantIds" @> ARRAY[${userId}]::text[] AND summary->>'userId'=${userId} AND COALESCE(summary->>'mode','points')=${mode}
      ), played AS (SELECT "handId","delta","result" FROM user_hands), hand_seats AS (
        SELECT seat."handId",seat."seatNo",seat."startingStack",hand."dealerSeat",
          COALESCE((hand."rules"->>'smallBlind')::int,1) AS "smallBlind",
          COALESCE((hand."rules"->>'bigBlind')::int,2) AS "bigBlind"
        FROM "GamePokerHandSeat" seat JOIN "GamePokerHand" hand ON hand."id"=seat."handId" JOIN played ON played."handId"=hand."id"
        UNION ALL
        SELECT seat->>'handId',(seat->>'seatNo')::int,(seat->>'startingStack')::int,(archive."data"->'hand'->>'dealerSeat')::int,
          COALESCE((archive."data"->'hand'->'rules'->>'smallBlind')::int,1),
          COALESCE((archive."data"->'hand'->'rules'->>'bigBlind')::int,2)
        FROM "GamePokerHandArchive" archive CROSS JOIN LATERAL jsonb_array_elements(archive."data"->'seats') AS entry(seat)
        JOIN played ON played."handId"=archive."id" WHERE archive."participantIds" @> ARRAY[${userId}]::text[]
      ), positions AS (
        SELECT *,count(*) OVER(PARTITION BY "handId") AS seats,
          row_number() OVER(PARTITION BY "handId" ORDER BY ("seatNo"-"dealerSeat"+10)%10) AS position
        FROM hand_seats
      ), blinds AS (
        SELECT "handId","seatNo","bigBlind",LEAST("startingStack",CASE
          WHEN position=CASE WHEN seats=2 THEN 1 ELSE 2 END THEN "smallBlind"
          WHEN position=CASE WHEN seats=2 THEN 2 ELSE 3 END THEN "bigBlind" ELSE 0 END) AS blind
        FROM positions
      ), all_moves AS (
        SELECT action."handId",action."seq",action."seatNo",action."userId",action."street",action."action",action."amount",action."isAuto"
        FROM "GamePokerAction" action JOIN played ON played."handId"=action."handId"
        UNION ALL
        SELECT action->>'handId',(action->>'seq')::int,(action->>'seatNo')::int,action->>'userId',action->>'street',action->>'action',(action->>'amount')::int,(action->>'isAuto')::boolean
        FROM "GamePokerHandArchive" archive CROSS JOIN LATERAL jsonb_array_elements(archive."data"->'actions') AS entry(action)
        JOIN played ON played."handId"=archive."id" WHERE archive."participantIds" @> ARRAY[${userId}]::text[]
      ), contributions AS (
        SELECT all_moves.*,COALESCE(blinds."bigBlind",2) AS "bigBlind",sum("amount") OVER(PARTITION BY "handId","street","seatNo" ORDER BY "seq")
          + CASE WHEN "street"='preflop' THEN COALESCE(blinds.blind,0) ELSE 0 END AS "streetBetAfter"
        FROM all_moves LEFT JOIN blinds USING("handId","seatNo")
      ), prior_bets AS (
        SELECT *,GREATEST(CASE WHEN "street"='preflop' THEN "bigBlind" ELSE 0 END,
          max("streetBetAfter") OVER(PARTITION BY "handId","street" ORDER BY "seq" ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)) AS "priorBet"
        FROM contributions
      ), moves AS (
        SELECT "handId","street",CASE WHEN "action"='allin' THEN
          CASE WHEN "streetBetAfter">"priorBet" THEN CASE WHEN "priorBet"=0 THEN 'bet' ELSE 'raise' END ELSE 'call' END
          ELSE "action" END AS "action"
        FROM prior_bets WHERE "userId"=${userId} AND NOT "isAuto"
      ) SELECT count(*)::int AS "hands",COALESCE(sum("delta"),0)::int AS "netProfit",count(*) FILTER(WHERE "result"='won')::int AS "wins",
        (SELECT count(DISTINCT "handId")::int FROM moves WHERE "street"='preflop' AND "action" IN ('call','bet','raise')) AS "vpipHands",
        (SELECT count(DISTINCT "handId")::int FROM moves WHERE "street"='preflop' AND "action"='raise') AS "pfrHands",
        (SELECT count(*)::int FROM moves WHERE "action" IN ('bet','raise')) AS "bets",
        (SELECT count(*)::int FROM moves WHERE "action"='call') AS "calls" FROM played`
    return {
      hands: s.hands,
      netProfit: s.netProfit,
      vpip: s.hands ? s.vpipHands / s.hands : 0,
      pfr: s.hands ? s.pfrHands / s.hands : 0,
      aggression: s.calls ? s.bets / s.calls : s.bets,
      winRate: s.hands ? s.wins / s.hands : 0,
    }
  }
}
