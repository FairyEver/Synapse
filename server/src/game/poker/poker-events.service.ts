import { publicRoll } from "./poker-roll-projection"
import { Injectable } from "@nestjs/common"
import type { GamePokerAction, GamePokerHand, GamePokerHandSeat } from "@prisma/client"
import type { PokerActionView, PokerTableEvent, PokerTableEventsView } from "@synapse/shared/game-contracts"
import { PokerService } from "./poker.service"
import { archiveData, type ArchivedHand } from "./poker-archive.service"
import { projectSettlement, type PokerViewPolicy } from "./poker-projection"
import { reject } from "./poker-error"
const MAX_SEQ = 2147483647
const REALTIME_WINDOW_MS = 120000
const timestamp = (value: Date | string | null): number => value ? new Date(value).getTime() : 0
function projectAction(action: GamePokerAction, seats: GamePokerHandSeat[], userId: string, policy: PokerViewPolicy): PokerActionView {
  const source = action.actionSource ?? (action.isAuto ? "timeout" : "mcp")
  return {
    seq: action.seq,
    seatNo: action.seatNo,
    displayName: seats.find((s) => s.seatNo === action.seatNo && s.userId === action.userId)?.displayName,
    street: action.street,
    action: action.action,
    amount: action.amount,
    potAfter: action.potAfter,
    isAuto: action.isAuto,
    actionSource: source === "human" || source === "rules_bot" || source === "timeout" ? source : "mcp",
    ...(policy.perspective === "owner" && action.userId === userId ? { note: action.note, personaVersionId: action.personaVersionId } : {}),
  }
}
@Injectable()
export class PokerEventsService {
  constructor(private readonly poker: PokerService) {}
  async events(
    userId: string,
    code: string,
    cursor = "",
    limit = 100,
    audience: PokerViewPolicy["audience"] = "decision",
    perspective: PokerViewPolicy["perspective"] = "public",
  ): Promise<PokerTableEventsView> {
    const match = /^(\d+):(\d+)$/.exec(cursor)
    const position = match ? [Number(match[1]), Number(match[2])] : null
    if ((cursor && (!position || position.some((v) => !Number.isSafeInteger(v) || v > MAX_SEQ))) ||
        !Number.isInteger(limit) || limit < 1 || limit > 100)
      reject("POKER_ILLEGAL_ACTION", "事件游标无效，单页须为1–100条。")
    return this.poker.withRoom(code, async (c) => {
      const currentHot = c.room.currentHandId ? await c.tx.gamePokerHand.findUnique({ where: { id: c.room.currentHandId } }) : null
      const currentCold = !currentHot && c.room.handNo ? await c.tx.gamePokerHandArchive.findUnique({ where: { roomId_handNo: { roomId: c.room.id, handNo: c.room.handNo } } }) : null
      const current = currentHot ?? (currentCold ? archiveData(currentCold.data).hand : null)
      const latest = `${c.room.handNo}:${current?.status === "settled" ? MAX_SEQ : current?.actionSeq ?? 0}`
      const empty = (): PokerTableEventsView => ({ events: [], cursor: latest, hasMore: false })
      // This is a live animation feed, never a second historical hand-detail API.
      if (!position || position[0] < Math.max(1, c.room.handNo - 1) ||
          position[0] > c.room.handNo ||
          (position[0] === c.room.handNo && position[1] >= (current?.status === "settled" ? MAX_SEQ : current?.actionSeq ?? 0))) return empty()
      const session = await c.tx.gameSession.findUnique({
        where: { userId_gameKind_gameRoomId: { userId, gameKind: "poker", gameRoomId: c.room.id } },
        select: { id: true },
      })
      const policy: PokerViewPolicy = {
        audience, perspective, mode: c.room.mode,
        everJoined: !!session || c.seats.some((s) => s.userId === userId),
      }
      const since = new Date(c.now.getTime() - REALTIME_WINDOW_MS)
      const handNo = { gte: Math.max(position[0], c.room.handNo - 1), lte: c.room.handNo }
      const hot = await c.tx.gamePokerHand.findMany({
        where: { roomId: c.room.id, handNo, OR: [{ startedAt: { gte: since } }, { endedAt: { gte: since } }, { id: c.room.currentHandId ?? "", status: { not: "settled" } }] },
        orderBy: { handNo: "asc" }, take: 2,
      })
      const cold = await c.tx.gamePokerHandArchive.findMany({
        where: { roomId: c.room.id, handNo, endedAt: { gte: since } },
        orderBy: { handNo: "asc" }, take: 2,
      })
      const records = new Map<number, { hand: GamePokerHand | ArchivedHand["hand"]; archive?: ArchivedHand }>()
      for (const entry of cold) {
        const archive = archiveData(entry.data)
        records.set(archive.hand.handNo, { hand: archive.hand, archive })
      }
      for (const hand of hot) records.set(hand.handNo, { hand })
      const events: PokerTableEvent[] = []
      for (const { hand, archive } of [...records.values()].sort((a, b) => a.hand.handNo - b.hand.handNo)) {
        if (hand.handNo < handNo.gte || hand.handNo > handNo.lte ||
            (hand.handNo === position[0] && position[1] === MAX_SEQ) ||
            (timestamp(hand.endedAt) < since.getTime() && timestamp(hand.startedAt) < since.getTime() && !(hand.id === c.room.currentHandId && hand.status !== "settled"))) continue
        const seats = archive?.seats ?? await c.tx.gamePokerHandSeat.findMany({ where: { handId: hand.id }, take: 10 })
        const afterSeq = hand.handNo === position[0] ? position[1] : 0
        const remaining = limit + 1 - events.length
        const actions = archive
          ? archive.actions.filter((a) => a.seq > afterSeq && timestamp(a.createdAt) >= since.getTime()).sort((a, b) => a.seq - b.seq).slice(0, remaining)
          : await c.tx.gamePokerAction.findMany({ where: { handId: hand.id, seq: { gt: afterSeq }, createdAt: { gte: since } }, orderBy: { seq: "asc" }, take: remaining })
        const rollIds = actions.filter(a => a.rollId).map(a => a.rollId!)
        const rolls = archive?.rolls ?? (rollIds.length ? await c.tx.gamePokerRoll.findMany({ where: { handId: hand.id, id: { in: rollIds } }, take: 101 }) : [])
        for (const action of actions) {
          if (action.action.startsWith("roll_")) {
            const roll = rolls.find(r => r.id === action.rollId)
            if (!roll) throw new Error("Roll event audit missing")
            events.push({ kind: "roll", handId: hand.id, handNo: hand.handNo, seq: action.seq, roll: publicRoll(roll, action, seats) })
          } else events.push({ kind: "action", handId: hand.id, handNo: hand.handNo, seq: action.seq, action: projectAction(action, seats, userId, policy) })
        }
        if (events.length > limit) break
        if (hand.status === "settled" && timestamp(hand.endedAt) >= since.getTime()) {
          // Bound source groups by the ten immutable hand participants.
          let sources = archive?.actions
          if (!sources) {
            const groups = await c.tx.gamePokerAction.groupBy({
              by: ["userId", "seatNo", "actionSource", "isAuto"], where: { handId: hand.id },
              orderBy: [{ userId: "asc" }, { seatNo: "asc" }, { actionSource: "asc" }, { isAuto: "asc" }], take: 100,
            })
            sources = groups.map((group) => ({ userId: group.userId, seatNo: group.seatNo, actionSource: group.actionSource, isAuto: group.isAuto }) as GamePokerAction)
          }
          const settlement = projectSettlement(hand, seats, sources, userId, policy)
          if (settlement) events.push({ kind: "settlement", handId: hand.id, handNo: hand.handNo, seq: MAX_SEQ, settlement })
        }
        if (events.length > limit) break
      }
      const page = events.slice(0, limit), last = page.at(-1)
      return { events: page, cursor: last ? `${last.handNo}:${last.seq}` : latest, hasMore: events.length > limit }
    }, new Date(), false)
  }
}
