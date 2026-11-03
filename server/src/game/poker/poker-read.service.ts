import { privateRoll, publicRoll } from "./poker-roll-projection"
import type { PokerStats, PokerAgentView } from "@synapse/shared/game-contracts"
import { Injectable } from "@nestjs/common"
import { Prisma, type GamePokerHandSummary } from "@prisma/client"
import { PokerService } from "./poker.service"
import { reject } from "./poker-error"
import { archiveData, type ArchivedHand } from "./poker-archive.service"
import { resolveRules, type PokerRules } from "./engine/rules"
import { publicHandResult } from "./poker-projection"
import { projectCardView, projectResolutionFrame } from "./poker-card-projection"
import { projectReserveView } from "./poker-reserve-projection"
import { engine } from "./poker-lifecycle"
import type { ResolutionFrame } from "./engine/cards/types"
import { isCardRoom } from "./poker-mode-policy"
@Injectable()
export class PokerReadService {
  constructor(private readonly poker: PokerService) {}
  async lobby(offset = 0, limit = 50, mode: "points" | "practice" | "all" = "points", userId?: string) {
    const rooms = await this.poker.prisma.gamePokerRoom.findMany({
      where: { status: { not: "closed" }, ...(mode === "all" ? {} : { mode }) },
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
        ruleOptions: true,
        rollPricingVersion: true,
        cardRulesVersion: true,
        chipRulesVersion: true,
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
    const page = rooms.slice(0, limit)
    const where = { userId, roomId: { in: page.map(room => room.id) } }
    const [mine, histories] = userId && page.length ? await Promise.all([
      this.poker.prisma.gamePokerSeat.findMany({ where, take: limit, select: { roomId: true, seatNo: true, controller: true, controlVersion: true, handoffPending: true } }),
      this.poker.prisma.gamePokerControlHistory.findMany({ where, take: limit, select: { roomId: true, controlVersion: true, joinPending: true } }),
    ]) : [[], []]
    return {
      items: page.map((r) => {
        const seat = mine.find(seat => seat.roomId === r.id), history = histories.find(history => history.roomId === r.id)
        const myControl = seat ? { seatNo: seat.seatNo, controller: seat.controller as "human" | "ai", controlVersion: seat.controlVersion, handoffPending: seat.handoffPending }
          : history ? { seatNo: null, controller: null, controlVersion: history.controlVersion, handoffPending: history.joinPending } : undefined
        return {
          ...(myControl ? { myControl } : {}),
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
        }
      }),
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
  async history(userId: string, offset = 0, limit = 50, mode: "points" | "practice" = "points", audience: "desktop" | "decision" = "decision") {
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
      select: { id: true, code: true, variant: true, smallBlind: true, bigBlind: true, ruleOptions: true, rollPricingVersion: true, cardRulesVersion: true, chipRulesVersion: true },
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
        hole: audience === "decision" && (rooms.find(room => room.id === r.roomId)?.ruleOptions as { cards?: boolean } | null)?.cards ? [] : r.holeCards,
        board: r.board,
        createdAt: r.createdAt,
      })),
      nextOffset: rows.length > limit ? offset + limit : null,
    }
  }
  async detail(userId: string, code: string, handNo: number, audience: "desktop" | "decision" = "decision") {
    return this.poker.prisma.$transaction(
      async (tx) => {
        const room = await tx.gamePokerRoom.findUnique({ where: { code }, select: { id: true, mode: true, ruleOptions: true, cardRulesVersion: true } })
        if (!room) reject("POKER_ROOM_NOT_FOUND", "房间不存在。")
        const hot = await tx.gamePokerHand.findUnique({
          where: { roomId_handNo: { roomId: room.id, handNo } },
        })
        let coldData: ArchivedHand | undefined
        let resolutions: ArchivedHand["resolutions"] = []
        let hand: ArchivedHand["hand"],
          participants: ArchivedHand["seats"],
          actions: ArchivedHand["actions"],
          rolls: ArchivedHand["rolls"] = []
        if (hot) {
          hand = hot
          if ((hot.rules as { chipRulesVersion?: string } | null)?.chipRulesVersion === "chips-v2") {
            let afterSeq = -1
            for (;;) { const page = await tx.gamePokerResolution.findMany({ where: { handId: hot.id, seq: { gt: afterSeq } }, orderBy: { seq: "asc" }, take: 1000 }); resolutions.push(...page); if (page.length < 1000) break; afterSeq = page.at(-1)!.seq }
          }
          participants = await tx.gamePokerHandSeat.findMany({
            where: { handId: hot.id },
            take: 10,
            orderBy: { seatNo: "asc" },
          })
          if (!participants.some((s) => s.userId === userId))
            reject("POKER_SEAT_NOT_FOUND", "只能读取本人参与的手牌。")
          let afterRollSeq = 0
          for (;;) {
            const page = await tx.gamePokerRoll.findMany({ where: { handId: hot.id, startSeq: { gt: afterRollSeq } }, orderBy: { startSeq: "asc" }, take: 1000 })
            rolls.push(...page)
            if (page.length < 1000) break
            afterRollSeq = page.at(-1)!.startSeq
          }
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
          coldData = data; resolutions = data.resolutions
          hand = data.hand
          participants = data.seats
          actions = data.actions
          rolls = data.rolls
        }
        if (!participants.some((s) => s.userId === userId))
          reject("POKER_SEAT_NOT_FOUND", "只能读取本人参与的手牌。")
        const cardMode = isCardRoom(room) || !!(hand.rules as { ruleOptions?: { cards?: boolean } } | null)?.ruleOptions?.cards
        const privateAllowed = !cardMode || audience === "desktop"
        const versionIds = [
          ...new Set(
            actions
              .filter((a) => privateAllowed && a.userId === userId && a.personaVersionId)
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
        const state = hot ? engine(hot) : null, ownParticipant = participants.find(p => p.userId === userId)
        const cardState = state ?? (coldData?.cards ? { archived: true as const, cards: coldData.cards, street: hand.street, seats: participants.map(p => ({ seatNo: p.seatNo, hole: p.holeCards as string[] })) } : null)
        const cards = cardState ? projectCardView(cardState, { audience, perspective: "owner", mode: room.mode, handId: hand.id, actionSeq: hand.actionSeq, nowMs: Date.now(), ...(ownParticipant?.admissionId ? { self: { userId, admissionId: ownParticipant.admissionId, seatNo: ownParticipant.seatNo, controlVersion: 0 } } : {}) }) : undefined
        const reserve = projectReserveView({ roomId: room.id, handId: hand.id, status: hand.status, userId, participants, state: state?.reserve ?? coldData?.reserve })
        return {
          ...(cards ? { cards } : {}), ...(reserve ? { reserve } : {}), ...(resolutions.length ? { frames: resolutions.map(r => projectResolutionFrame(r.data as unknown as ResolutionFrame)) } : {}),
          mode: room.mode,
          rules: resolveRules((hand.rules ?? {}) as Partial<PokerRules>),
          handId: hand.id,
          handNo: hand.handNo,
          roomCode: code,
          board: hand.board,
          street: hand.street,
          result: publicHandResult(hand.result),
          seats: participants.map((s) => ({
            seatNo: s.seatNo,
            displayName: s.displayName,
            participantKind: s.participantKind ?? "human",
            startingStack: s.startingStack,
            endingStack: s.endingStack,
            folded: s.folded,
            ...(privateAllowed && s.userId === userId || (!s.folded && shown.includes(s.seatNo))
              ? { hole: s.holeCards }
              : {}),
          })),
          rollHistory: actions.filter(a => a.rollId && a.action.startsWith("roll_")).flatMap(a => { const roll = rolls.find(r => r.id === a.rollId); return roll ? [publicRoll(roll, a, participants)] : [] }),
          ...(privateAllowed ? { privateRolls: rolls.filter(r => r.userId === userId && participants.some(p => p.userId === userId && p.admissionId === r.admissionId && p.seatNo === r.seatNo)).map(privateRoll) } : {}),
          actions: actions.filter(a => !a.action.startsWith("roll_")).map((a) => ({
            seq: a.seq,
            seatNo: a.seatNo,
            street: a.street,
            action: a.action,
            amount: a.amount,
            ...(a.nominalAmount == null ? {} : { nominalAmount: a.nominalAmount, waivedAmount: a.waivedAmount ?? 0 }),
            potAfter: a.potAfter,
            isAuto: a.isAuto,
            actionSource: a.actionSource ?? (a.isAuto ? "timeout" : "mcp"),
            elapsedMs: a.elapsedMs,
            ...(privateAllowed && a.userId === userId
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
        SELECT action."handId",action."seq",action."seatNo",action."userId",action."street",action."action",action."amount",COALESCE(action."nominalAmount",action."amount") AS "nominalAmount",action."isAuto"
        FROM "GamePokerAction" action JOIN played ON played."handId"=action."handId"
        UNION ALL
        SELECT action->>'handId',(action->>'seq')::int,(action->>'seatNo')::int,action->>'userId',action->>'street',action->>'action',(action->>'amount')::int,COALESCE((action->>'nominalAmount')::int,(action->>'amount')::int),(action->>'isAuto')::boolean
        FROM "GamePokerHandArchive" archive CROSS JOIN LATERAL jsonb_array_elements(archive."data"->'actions') AS entry(action)
        JOIN played ON played."handId"=archive."id" WHERE archive."participantIds" @> ARRAY[${userId}]::text[]
      ), contributions AS (
        SELECT all_moves.*,COALESCE(blinds."bigBlind",2) AS "bigBlind",sum("nominalAmount") OVER(PARTITION BY "handId","street","seatNo" ORDER BY "seq")
          + CASE WHEN "street"='preflop' THEN COALESCE(blinds.blind,0) ELSE 0 END AS "streetBetAfter"
        FROM all_moves LEFT JOIN blinds USING("handId","seatNo") WHERE "action" NOT IN ('roll_start','roll_choose','card_play','card_choose')
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
