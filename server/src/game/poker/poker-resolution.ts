import { randomInt, randomUUID } from "node:crypto"
import type { Prisma } from "@prisma/client"
import type { PokerService, RoomContext } from "./poker.service"
import type { ResolutionContext, HandResolution } from "./engine/cards/types"
import type { HandState } from "./engine/hand-runner"

export const reserveScope = (c: RoomContext, handId: string) => ({ gameKind: "poker", gameRoomId: c.room.id, settlementId: handId, funding: c.room.mode === "practice" ? "practice" as const : "points" as const })
export function roomResolutionContext(c: RoomContext, handId: string, seq: number, rootActionId: string, actor: { id: string; seatNo: number } | null, source: ResolutionContext["source"]): ResolutionContext {
  return { handId, actionSeq: seq, rootActionId, actorSeatNo: actor?.seatNo ?? null, actorAdmissionId: actor?.id ?? null, source, nowMs: c.now.getTime(), randomInt, nextId: randomUUID }
}
export async function persistHandResolution(poker: PokerService, c: RoomContext, resolution: HandResolution, context: ResolutionContext, previous?: HandState): Promise<void> {
  if (resolution.reserveBatch) await poker.reserves.apply(c.tx, resolution.reserveBatch)
  const state = resolution.state
  for (const record of state.roll?.history ?? []) {
    const before = previous?.roll?.history.find(r => r.id === record.id)
    if (!before) {
      const participant = state.participants?.find(p => p.seatNo === record.seatNo)
      if (!participant) throw new Error("Roll original participant missing")
      await c.tx.gamePokerRoll.create({ data: { id: record.id, roomId: c.room.id, handId: context.handId, userId: participant.userId, admissionId: participant.admissionId, seatNo: record.seatNo,
        startSeq: context.actionSeq, data: record as unknown as Prisma.InputJsonValue, createdAt: c.now, completedAt: record.selectedIndex === null ? null : c.now } })
    } else if (before.selectedIndex !== record.selectedIndex) await c.tx.gamePokerRoll.update({ where: { id: record.id }, data: { data: record as unknown as Prisma.InputJsonValue, chooseSeq: context.actionSeq, completedAt: c.now } })
    else if (previous?.roll?.pending?.id === record.id && state.roll?.pending?.id !== record.id) await c.tx.gamePokerRoll.update({ where: { id: record.id }, data: { completedAt: c.now } })
  }
  await c.tx.gamePokerResolution.create({ data: { id: resolution.frame.id, roomId: c.room.id, handId: context.handId, seq: context.actionSeq, actionId: context.rootActionId,
    actorAdmissionId: context.actorAdmissionId, actorUserId: state.participants?.find(p => p.admissionId === context.actorAdmissionId)?.userId ?? null, source: context.source, version: state.cardRulesVersion ?? state.chipRulesVersion!, data: resolution.frame as unknown as Prisma.InputJsonValue, createdAt: c.now } })
}
