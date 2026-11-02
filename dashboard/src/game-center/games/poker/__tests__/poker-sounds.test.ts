import { describe, expect, it } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { pokerSoundCues } from "../lib/poker-sounds"
import { soundTable, wager } from "./sound-fixture"

function winningTable(profit: number, payout = profit + 10): PokerTableView {
  return { ...soundTable, street: "settled", settlement: {
    handId: "h1", handNo: 1, board: [], rules: { variant: "standard52", smallBlind: 1, bigBlind: 2 }, mixedControl: false,
    seats: [{ seatNo: 0, displayName: "本人", participantKind: "human", isMe: true, folded: false, delta: profit, payout, endingStack: 1000 + profit }],
    pots: [{ amount: payout, eligible: [0, 1], winners: [0], shares: { 0: payout }, refund: false }],
  } }
}

describe("德扑声音反馈", () => {
  it("金额变化不提前触发筹码声，所有碰撞交给实际动画落地", () => {
    for (const amount of [1, 5, 10, 501, 1000, 1_000_000]) {
      expect(pokerSoundCues(soundTable, wager(amount), "owner")).toEqual([])
    }
    for (const perspective of ["owner", "public"] as const) {
      expect(pokerSoundCues(soundTable, winningTable(100), perspective)).toEqual([])
    }
    expect(pokerSoundCues(soundTable, { ...soundTable }, "owner")).toEqual([])
  })

  it("新手发牌有声，翻牌和过牌弃牌有不同反馈", () => {
    const next = { ...soundTable, handId: "h2", handNo: 2 }
    expect(pokerSoundCues(soundTable, next, "owner").some(c => c.sound === "deal")).toBe(true)
    expect(pokerSoundCues(soundTable, { ...next, seats: next.seats.map(s => ({ ...s, status: "allin" })) }, "owner").filter(c => c.sound === "deal")).toHaveLength(4)
    const flop = { ...soundTable, street: "flop", board: ["As", "Kh", "7c"] }
    expect(pokerSoundCues(soundTable, flop, "owner").filter(c => c.sound === "card")).toHaveLength(3)
    const action = wager(0)
    for (const [kind, sound] of [["check", "tap"], ["fold", "fold"]] as const) {
      const table = { ...action, recentActions: action.recentActions.map(a => ({ ...a, action: kind })) }
      expect(pokerSoundCues(soundTable, table, "owner").some(c => c.sound === sound)).toBe(true)
    }
  })

  it("翻三张牌清晰响三次，转牌河牌各一次，重复快照不多响", () => {
    const flop = { ...soundTable, street: "flop", board: ["As", "Kh", "7c"] }
    const turn = { ...flop, street: "turn", board: [...flop.board, "8d"] }
    const river = { ...turn, street: "river", board: [...turn.board, "9s"] }
    const cards = pokerSoundCues(soundTable, flop, "owner").filter(c => c.sound === "card")
    expect(cards).toHaveLength(3)
    expect(cards[1].delay - cards[0].delay).toBe(120)
    expect(cards[2].delay - cards[1].delay).toBe(120)
    expect(pokerSoundCues(flop, turn, "owner").filter(c => c.sound === "card")).toHaveLength(1)
    expect(pokerSoundCues(turn, river, "owner").filter(c => c.sound === "card")).toHaveLength(1)
    expect(pokerSoundCues(river, { ...river }, "owner")).toEqual([])
  })

  it("只在本人可操作的新轮次提示，不给旁观或 AI 提示", () => {
    const next = { ...soundTable, actionOnSeat: 0 }
    expect(pokerSoundCues(soundTable, next, "owner").some(c => c.sound === "turn")).toBe(true)
    expect(pokerSoundCues(soundTable, next, "public")).toEqual([])
    expect(pokerSoundCues(soundTable, { ...next, controller: "ai" }, "owner")).toEqual([])
  })

  it("过旧或跨房间快照不补播，跨多手只建立新基线", () => {
    expect(pokerSoundCues(wager(8), soundTable, "owner")).toEqual([])
    expect(pokerSoundCues(soundTable, { ...wager(8), roomCode: "5678" }, "owner")).toEqual([])
    expect(pokerSoundCues(soundTable, { ...wager(8), handId: "h9", handNo: 9 }, "owner")).toEqual([])
    expect(pokerSoundCues(soundTable, { ...wager(8), status: "closed" }, "owner")).toEqual([])
  })
})
