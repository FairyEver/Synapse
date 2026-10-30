import { describe, expect, it } from "vitest"
import { chooseBotAction } from "../bot-policy"
import { startHand, act, legalActions } from "../engine/hand-runner"
import { orderedDeck } from "../engine/deck"
describe("陪练规则策略", () => {
  it("弱牌免费时过牌，大额欠注弃牌", () => {
    const base = { hole: ["2s", "7h"], board: [], pot: 10, stack: 1000, streetBet: 0 }
    expect(chooseBotAction({ ...base, legal: { actions: ["fold", "check"], toCall: 0, minRaiseTo: 2, maxRaiseTo: 1000 } }, 0.9)).toEqual({ action: "check" })
    expect(chooseBotAction({ ...base, legal: { actions: ["fold", "call"], toCall: 900, minRaiseTo: 1000, maxRaiseTo: 1000 } }, 0.9)).toEqual({ action: "fold" })
  })
  it("不同牌况与随机输入的动作始终通过引擎校验，没有未授权加注", () => {
    for (let seed = 0; seed < 30; seed++) {
      let hand = startHand([{ seatNo: 0, stack: 15 }, { seatNo: 1, stack: 37 }, { seatNo: 2, stack: 100 }], 0, orderedDeck())
      for (let step = 0; hand.street !== "settled" && step < 100; step++) {
        const seat = hand.seats.find((s) => s.seatNo === hand.actionOnSeat)!
        const input = { hole: seat.hole, board: hand.board, pot: hand.seats.reduce((n, s) => n + s.total, 0), stack: seat.stack, streetBet: seat.streetBet, legal: legalActions(hand, seat.seatNo) }
        const random = ((seed * 17 + step * 31) % 100) / 100
        const decision = chooseBotAction(input, random)
        expect(chooseBotAction(input, random)).toEqual(decision)
        expect(input.legal.actions).toContain(decision.action)
        hand = act(hand, seat.seatNo, decision)
      }
      expect(hand.street).toBe("settled")
      expect(hand.seats.reduce((n, s) => n + s.stack, 0)).toBe(152)
    }
  })
})
