import { describe, expect, it, vi } from "vitest"
import { PokerActionService } from "../poker-action.service"
import { startHand } from "../engine/hand-runner"
import { orderedDeck } from "../engine/deck"
import type { RoomContext, PokerService } from "../poker.service"

describe("座位参与状态投影", () => {
  it("区分本手、下一手和历史座位，身份不因座位号相同而混用", async () => {
    const state = startHand([{ seatNo: 0, stack: 1000 }, { seatNo: 1, stack: 1000 }], 0, orderedDeck())
    const hand = { id: "hand", handNo: 1, actionSeq: 0, engineState: state, status: "running", street: "preflop", pot: 3 }
    const participant = { seatNo: 1, userId: "old", participantKind: "bot", displayName: "已移除", endingStack: 990, folded: false }
    const current = { id: "new", userId: "new", roomId: "room", seatNo: 0, displayName: "后来加入", participantKind: "bot", stack: 1000, status: "waiting", joinedHandNo: 2, lastSeenAt: new Date() }
    const c = {
      room: { id: "room", code: "1234", currentHandId: "hand", mode: "practice", status: "running", handNo: 1, maxSeats: 4, actionDeadlineAt: null },
      seats: [current], now: new Date(),
      tx: {
        gamePokerHand: { findUnique: vi.fn().mockResolvedValue(hand) },
        gameSession: { findUnique: vi.fn().mockResolvedValue(null) },
        gamePokerControlHistory: { findUnique: vi.fn().mockResolvedValue(null) },
        gamePokerAction: { findMany: vi.fn().mockResolvedValue([]) },
        gamePokerHandSeat: { findMany: vi.fn().mockResolvedValue([{ ...participant, seatNo: 0, userId: "previous-at-same-seat" }, participant]) },
      },
    } as unknown as RoomContext
    const view = await new PokerActionService({} as PokerService).view(c, "viewer", "public", false)
    expect(view.seats.find(s => s.seatNo === 0)).toMatchObject({ isHistorical: false, inCurrentHand: false, botId: "new" })
    expect(view.seats.find(s => s.seatNo === 1)).toMatchObject({ isHistorical: true, inCurrentHand: true })
    expect(view.seats.find(s => s.seatNo === 1)).not.toHaveProperty("botId")
    expect(view.seats.every(s => !("hole" in s))).toBe(true)
  })
})
