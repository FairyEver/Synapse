import { describe, expect, it } from "vitest"
import { chooseBotAction } from "../../bot-policy"
import { orderedDeck } from "../deck"
import { evaluate, compareHands, handRankName } from "../hand"
import { act, legalActions, startHand } from "../hand-runner"

const cards = (text: string) => text.split(" ")
describe("32张短牌规则", () => {
  it("只有7到A且保持标准52默认牌堆", () => {
    expect(orderedDeck()).toHaveLength(52)
    expect(orderedDeck("short32")).toHaveLength(32)
    expect(orderedDeck("short32").every((c) => "789TJQKA".includes(c[0]))).toBe(true)
  })
  it("同花大于葫芦，标准52保持葫芦大于同花", () => {
    const flush = cards("As Js Ts 9s 7s"), full = cards("Kh Kd Kc Ah Ad")
    expect(compareHands(flush, full, "short32")).toBe(1)
    expect(compareHands(flush, full)).toBe(-1)
    expect(handRankName(flush, "short32")).toBe("同花")
    expect(handRankName(full, "short32")).toBe("葫芦")
  })
  it("A789T为最小顺子，禁止其它环绕", () => {
    expect(evaluate(cards("As 7d 8c 9h Ts"), "short32")).toEqual({ category: 4, kickers: [10] })
    expect(compareHands(cards("As 7d 8c 9h Ts"), cards("7s 8d 9c Th Js"), "short32")).toBe(-1)
    expect(evaluate(cards("Qs Kd Ac 7h 8s"), "short32").category).toBe(0)
    expect(() => evaluate(cards("As 2d 3c 4h 5s"), "short32")).toThrow("无效牌面")
  })
  it("10座发牌和全下结算均守恒并保存分池赢家", () => {
    let h = startHand(Array.from({ length: 10 }, (_, seatNo) => ({ seatNo, stack: 10 })), 0, orderedDeck("short32"), { variant: "short32", smallBlind: 5, bigBlind: 10 })
    while (h.street !== "settled") h = act(h, h.actionOnSeat!, { action: "allin" })
    expect(h.variant).toBe("short32")
    expect(h.board).toHaveLength(5)
    expect(h.seats.reduce((n, s) => n + s.stack, 0)).toBe(100)
    expect(h.pots.every((p) => p.winners!.length > 0 && Object.values(p.shares!).reduce((n, amount) => n + amount, 0) === p.amount)).toBe(true)
  })
})
describe.each([[1, 2], [2, 4], [5, 10], [10, 20]])("盲注 %i/%i", (smallBlind, bigBlind) => {
  it("按房间盲注发牌并在每街重置最小加注", () => {
    let h = startHand([{ seatNo: 0, stack: 1000 }, { seatNo: 1, stack: 1000 }], 0, orderedDeck(), { smallBlind, bigBlind })
    expect(h.currentBet).toBe(bigBlind)
    expect(h.seats.find((s) => s.seatNo === 0)!.streetBet).toBe(smallBlind)
    h = act(h, 0, { action: "call" })
    h = act(h, 1, { action: "check" })
    expect(h.street).toBe("flop")
    expect(h.minRaise).toBe(bigBlind)
    expect(legalActions(h, 1).minRaiseTo).toBe(bigBlind)
  })
})
it("短牌拒绝52张牌堆和非支持盲注", () => {
  const seats = [{ seatNo: 0, stack: 10 }, { seatNo: 1, stack: 10 }]
  expect(() => startHand(seats, 0, orderedDeck(), { variant: "short32" })).toThrow()
  expect(() => startHand(seats, 0, orderedDeck(), { smallBlind: 3, bigBlind: 6 })).toThrow()
})

it("短牌结算用本手规则将同花判胜葫芦，标准规则维持葫芦获胜", () => {
  const prefix = cards("Kh Ts Ac Js 7h Ks Kd As 7d 8s 7c 9s")
  for (const variant of ["short32", "standard52"] as const) {
    const deck = [...prefix, ...orderedDeck(variant).filter((c) => !prefix.includes(c))]
    let h = startHand([{ seatNo: 0, stack: 100 }, { seatNo: 1, stack: 100 }], 0, deck, { variant })
    h = act(h, 0, { action: "allin" })
    h = act(h, 1, { action: "call" })
    expect(h.pots[0].winners).toEqual([variant === "short32" ? 0 : 1])
    expect(h.payouts[variant === "short32" ? 0 : 1]).toBe(200)
  }
})
it("短牌机器人仅评估本人及公共牌并消费规则", () => {
  const input = { variant: "short32" as const, hole: ["As", "7h"], board: ["8s", "9h", "Tc"], pot: 10, stack: 100, streetBet: 0, legal: { actions: ["fold", "call"] as ("fold" | "call")[], toCall: 7, minRaiseTo: 10, maxRaiseTo: 100 } }
  expect(chooseBotAction(input, 0.9)).toEqual({ action: "call" })
  expect(chooseBotAction({ ...input, variant: "standard52" }, 0.9)).toEqual({ action: "fold" })
})
it("短牌多档盲注确定性动作序列200手守恒", () => {
  let seed = 3121
  const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max }
  for (let n = 0; n < 200; n++) {
    const [smallBlind, bigBlind] = [[1, 2], [2, 4], [5, 10], [10, 20]][n % 4]
    const count = 2 + random(9)
    let h = startHand(Array.from({ length: count }, (_, seatNo) => ({ seatNo, stack: 1 + random(500) })), n % count, orderedDeck("short32"), { variant: "short32", smallBlind, bigBlind })
    const total = h.seats.reduce((sum, s) => sum + s.startingStack, 0)
    let turns = 0
    while (h.street !== "settled") {
      expect(++turns).toBeLessThan(500)
      const legal = legalActions(h, h.actionOnSeat!)
      h = act(h, h.actionOnSeat!, { action: legal.actions[random(legal.actions.length)], to: legal.minRaiseTo })
      expect(h.seats.every((s) => Number.isSafeInteger(s.stack) && s.stack >= 0)).toBe(true)
    }
    expect(h.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(total)
  }
})
