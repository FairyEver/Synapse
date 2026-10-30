import { describe, expect, it } from "vitest"
import { orderedDeck, shuffle } from "../deck"
import { act, legalActions, startHand } from "../hand-runner"

describe("短盲注与无人可应答的全下", () => {
  it("单挑大盲仅剩1且小盲已匹配时直接发完牌，不要求再投入可退回的1", () => {
    const hand = startHand(
      [
        { seatNo: 0, stack: 1000 },
        { seatNo: 1, stack: 1 },
      ],
      0,
      orderedDeck(),
    )
    expect(hand.street).toBe("settled")
    expect(hand.actionOnSeat).toBeNull()
    expect(hand.board).toHaveLength(5)
    expect(hand.seats.map((s) => s.total)).toEqual([1, 1])
    expect(hand.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(1001)
  })
  it("两盲都仅剩1时，唯一有筹码者只需跟实际的1，没有加注对象", () => {
    let hand = startHand(
      [
        { seatNo: 0, stack: 1000 },
        { seatNo: 1, stack: 1 },
        { seatNo: 2, stack: 1 },
      ],
      0,
      orderedDeck(),
    )
    expect(hand.actionOnSeat).toBe(0)
    expect(legalActions(hand, 0)).toMatchObject({ toCall: 1, actions: ["fold", "call"] })
    hand = act(hand, 0, { action: "call" })
    expect(hand.street).toBe("settled")
    expect(hand.seats.map((s) => s.total)).toEqual([1, 1, 1])
  })
  it("面对唯一全下对手时禁止无人能跟的加注或超额全下", () => {
    let hand = startHand(
      [
        { seatNo: 0, stack: 1000 },
        { seatNo: 1, stack: 200 },
      ],
      0,
      orderedDeck(),
    )
    hand = act(hand, 0, { action: "call" })
    hand = act(hand, 1, { action: "allin" })
    expect(legalActions(hand, 0)).toMatchObject({ toCall: 198, actions: ["fold", "call"] })
    expect(() => act(hand, 0, { action: "raise", to: 500 })).toThrow()
    expect(() => act(hand, 0, { action: "allin" })).toThrow()
    hand = act(hand, 0, { action: "call" })
    expect(hand.street).toBe("settled")
    expect(hand.seats.map((s) => s.total)).toEqual([200, 200])
  })
  it("面对全下仍允许不足额全下跟注", () => {
    let hand = startHand(
      [
        { seatNo: 0, stack: 100 },
        { seatNo: 1, stack: 200 },
      ],
      0,
      orderedDeck(),
    )
    hand = act(hand, 0, { action: "call" })
    hand = act(hand, 1, { action: "allin" })
    expect(legalActions(hand, 0).actions).toContain("allin")
    expect(act(hand, 0, { action: "allin" }).street).toBe("settled")
  })
  it("仍有多个有筹码者时，短大盲不会降低正常的完整大盲和最小加注", () => {
    const hand = startHand(
      [
        { seatNo: 0, stack: 1000 },
        { seatNo: 1, stack: 1000 },
        { seatNo: 2, stack: 1 },
      ],
      0,
      orderedDeck(),
    )
    expect(legalActions(hand, 0)).toMatchObject({ toCall: 2, minRaiseTo: 4 })
    expect(legalActions(hand, 0).actions).toContain("raise")
  })
  it("1至5筹码的1000手随机行动均能终止且筹码守恒", () => {
    let seed = 73291
    const random = (max: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed % max
    }
    for (let i = 0; i < 1000; i++) {
      const count = 2 + random(9)
      let hand = startHand(
        Array.from({ length: count }, (_, seatNo) => ({ seatNo, stack: 1 + random(5) })),
        i % count,
        shuffle(orderedDeck(), random),
      )
      const total = hand.seats.reduce((sum, seat) => sum + seat.startingStack, 0)
      let actions = 0
      while (hand.street !== "settled") {
        expect(++actions).toBeLessThan(100)
        const legal = legalActions(hand, hand.actionOnSeat!)
        expect(legal.actions.length).toBeGreaterThan(0)
        hand = act(hand, hand.actionOnSeat!, {
          action: legal.actions[random(legal.actions.length)],
          to: legal.minRaiseTo,
        })
        expect(
          hand.seats.every((seat) => Number.isSafeInteger(seat.stack) && seat.stack >= 0),
        ).toBe(true)
      }
      expect(hand.seats.reduce((sum, seat) => sum + seat.stack, 0)).toBe(total)
    }
  })
})
