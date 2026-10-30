import { randomInt, randomUUID } from "node:crypto"
import type { GamePokerHand } from "@prisma/client"
import type { PokerService, RoomContext } from "./poker.service"
import { json } from "./poker.service"
import { startHand, type HandState } from "./engine/hand-runner"
import { orderedDeck, shuffle } from "./engine/deck"
import { after } from "./engine/seat-order"
export const ACTION_WINDOW_MS = 600000
export function engine(hand: GamePokerHand): HandState {
  return hand.engineState as unknown as HandState
}
export async function startNext(
  poker: PokerService,
  c: RoomContext,
  automaticBudget = 8,
): Promise<void> {
  if (c.room.status === "closed") return
  const previous = c.room.currentHandId
    ? await c.tx.gamePokerHand.findUnique({ where: { id: c.room.currentHandId } })
    : null
  if (previous && previous.status !== "settled") return
  if (c.room.closeRequested) {
    for (const seat of [...c.seats].sort((a, b) => a.userId.localeCompare(b.userId))) {
      await poker.refund(c, seat)
    }
    c.room = await c.tx.gamePokerRoom.update({
      where: { id: c.room.id },
      data: { status: "closed", closedAt: c.now, actionDeadlineAt: null },
    })
    return
  }
  const eligible = c.seats.filter(
    (s) => s.stack > 0 && s.status !== "sitting_out" && !s.sitPending && !s.leavePending,
  )
  if (eligible.length < 2 || !eligible.some((s) => s.participantKind !== "bot")) {
    await c.tx.gamePokerRoom.update({
      where: { id: c.room.id },
      data: { status: c.room.handNo ? "paused" : "waiting", actionDeadlineAt: null, botActionAt: null },
    })
    await c.tx.gameSession.updateMany({
      where: { gameKind: "poker", gameRoomId: c.room.id, status: { not: "closed" } },
      data: { needsAction: false, deadlineAt: null },
    })
    return
  }
  const dealerSeat = c.room.handNo
    ? after(
        eligible.map((s) => s.seatNo),
        c.room.dealerSeat,
      )[0]
    : eligible[0].seatNo
  const state = startHand(eligible, dealerSeat, shuffle(orderedDeck(), randomInt))
  const hand = await c.tx.gamePokerHand.create({
    data: {
      roomId: c.room.id,
      handNo: c.room.handNo + 1,
      dealerSeat,
      board: [],
      street: state.street,
      status: "running",
      engineState: json(state),
      startedAt: c.now,
    },
  })
  c.room = await c.tx.gamePokerRoom.update({
    where: { id: c.room.id },
    data: {
      status: "running",
      handNo: hand.handNo,
      currentHandId: hand.id,
      dealerSeat,
      actionDeadlineAt: new Date(c.now.getTime() + ACTION_WINDOW_MS),
    },
  })
  await c.tx.gamePokerHandSeat.createMany({
    data: state.seats.map((s) => ({
      handId: hand.id,
      seatNo: s.seatNo,
      userId: eligible.find((p) => p.seatNo === s.seatNo)!.userId,
      participantKind: eligible.find((p) => p.seatNo === s.seatNo)!.participantKind,
      displayName: eligible.find((p) => p.seatNo === s.seatNo)!.displayName,
      holeCards: s.hole,
      startingStack: s.startingStack,
    })),
  })
  await saveHand(poker, c, hand, state)
  if (state.street === "settled" && c.room.status !== "closed") {
    if (automaticBudget > 0) await startNext(poker, c, automaticBudget - 1)
    else
      await c.tx.gamePokerRoom.update({
        where: { id: c.room.id },
        data: { actionDeadlineAt: new Date(c.now.getTime() + 1000) },
      })
  }
}
export async function saveHand(
  poker: PokerService,
  c: RoomContext,
  hand: GamePokerHand,
  state: HandState,
): Promise<void> {
  const settled = state.street === "settled"
  const pot = settled ? 0 : state.seats.reduce((sum, s) => sum + s.total, 0)
  await c.tx.gamePokerHand.update({
    where: { id: hand.id },
    data: {
      engineState: json(state),
      board: state.board,
      street: state.street,
      pot,
      status: settled ? "settled" : "running",
      showdownSeats: state.showdownSeats,
      ...(settled
        ? { endedAt: c.now, result: json({ payouts: state.payouts, pots: state.pots }) }
        : {}),
    },
  })
  const deadlineAt = settled ? null : new Date(c.now.getTime() + ACTION_WINDOW_MS)
  await c.tx.gamePokerRoom.update({
    where: { id: c.room.id },
    data: {
      actionDeadlineAt: deadlineAt,
      botActionAt: !settled && c.room.mode === "practice" && c.seats.some((s) => s.seatNo === state.actionOnSeat && s.participantKind === "bot")
        ? new Date(c.now.getTime() + 1000) : null,
    },
  })
  for (const s of c.seats) {
    const p = state.seats.find((p) => p.seatNo === s.seatNo)
    if (!p || (s.joinedHandNo ?? 0) > hand.handNo) continue
    s.stack = p.stack
    s.status = settled
      ? s.sitPending
        ? "sitting_out"
        : "waiting"
      : p.folded
        ? "folded"
        : p.allIn
          ? "allin"
          : "active"
    await c.tx.gamePokerSeat.update({
      where: { id: s.id },
      data: { stack: s.stack, status: s.status },
    })
    if (s.participantKind !== "bot") await c.tx.gameSession.updateMany({
      where: {
        userId: s.userId,
        gameKind: "poker",
        gameRoomId: c.room.id,
        status: { not: "closed" },
      },
      data: {
        inPlay: c.room.mode === "practice" ? 0 : p.stack + (settled ? 0 : p.total),
        status: ["waiting", "sitting_out"].includes(s.status) ? s.status : "active",
        needsAction: !settled && state.actionOnSeat === s.seatNo,
        deadlineAt: !settled && state.actionOnSeat === s.seatNo ? deadlineAt : null,
        lastActiveAt: c.now,
      },
    })
  }
  if (settled) {
    const participants = await c.tx.gamePokerHandSeat.findMany({
      where: { handId: hand.id },
      take: 10,
    })
    for (const p of state.seats) {
      const participant = participants.find((s) => s.seatNo === p.seatNo)!
      await c.tx.gamePokerHandSeat.update({
        where: { id: participant.id },
        data: { endingStack: p.stack, folded: p.folded, allIn: p.allIn },
      })
      const delta = p.stack - p.startingStack
      await c.tx.gamePokerHandSummary.create({
        data: {
          handId: hand.id,
          roomId: c.room.id,
          mode: c.room.mode,
          handNo: hand.handNo,
          userId: participant.userId,
          seatNo: p.seatNo,
          delta,
          result: delta > 0 ? "won" : delta < 0 ? "lost" : "split",
          holeCards: p.hole,
          board: state.board,
        },
      })
    }
    for (const seat of [...c.seats].sort((a, b) => a.userId.localeCompare(b.userId)))
      if (c.room.closeRequested || seat.leavePending || seat.stack === 0)
        await poker.refund(c, seat)
    if (c.room.closeRequested)
      c.room = await c.tx.gamePokerRoom.update({
        where: { id: c.room.id },
        data: { status: "closed", closedAt: c.now, actionDeadlineAt: null },
      })
  }
}
