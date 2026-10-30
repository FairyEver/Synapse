import { describe, expect, it } from "vitest"
import { orderedDeck, shuffle } from "../deck"
import { evaluate, compareHands } from "../hand"
import { seatOrder } from "../seat-order"
import { splitPots, distribute } from "../pots"
import { applyBet } from "../betting"
import { startHand, act, legalActions } from "../hand-runner"

const cards = (s: string) => s.split(" ")
describe("牌力与牌堆", () => {
  it("52张唯一牌，洗牌由调用者提供熵且不修改原数组", () => {
    const deck = orderedDeck()
    const shuffled = shuffle(deck, (max) => max - 1)
    expect(new Set(shuffled).size).toBe(52)
    expect(deck).toEqual(orderedDeck())
    expect(shuffled).toEqual(deck)
  })
  it.each([
    ["As Ks Qs Js Ts 2d 3c", 9],
    ["9s 8s 7s 6s 5s Ad Kc", 8],
    ["As Ah Ad Ac Ks 2s 3s", 7],
    ["As Ah Ad Ks Kh 2s 3s", 6],
    ["As Js 8s 5s 2s 3d 4c", 5],
    ["As 2h 3d 4c 5s 9s Ts", 4],
    ["As Ah Ad Ks Qh 2s 3s", 3],
    ["As Ah Kd Ks Qh 2s 3s", 2],
    ["As Ah Kd Qs Jh 2s 3s", 1],
    ["As Kh Jd 9s 7h 2s 3s", 0],
  ])("评估%s", (input, category) => expect(evaluate(cards(input)).category).toBe(category))
  it("踢脚牌比较与公共牌平局", () => {
    expect(compareHands(cards("As Ah Kd Qs Jh 2s 3s"), cards("Ac Ad Kc Qc Th 4s 5s"))).toBe(1)
    expect(compareHands(cards("As Ks Qs Js Ts 2d 3c"), cards("As Ks Qs Js Ts 4d 5c"))).toBe(0)
  })
})
describe("引擎输入不可变", () => {
  it("下注转换返回新状态，不修改调用方的牌局、座位或牌堆", () => {
    const state = startHand(
      [
        { seatNo: 0, stack: 1000 },
        { seatNo: 1, stack: 1000 },
      ],
      0,
      orderedDeck(),
    )
    const original = structuredClone(state)
    const next = applyBet(state, 0, { action: "call" })
    expect(state).toEqual(original)
    expect(next.seats[0].stack).toBe(998)
    expect(next).not.toBe(state)
    expect(next.seats[0]).not.toBe(state.seats[0])
  })
})
describe("位置与边池", () => {
  it("单挑按钮即小盲，翻前先、翻后后", () =>
    expect(seatOrder([2, 7], 2)).toEqual({
      smallBlind: 2,
      bigBlind: 7,
      preflop: [2, 7],
      postflop: [7, 2],
    }))
  it.each([3, 6, 10])("%i人桌从大盲下家开始", (n) => {
    const o = seatOrder(
      Array.from({ length: n }, (_, i) => i),
      0,
    )
    expect(o.smallBlind).toBe(1)
    expect(o.bigBlind).toBe(2)
    expect(o.preflop[0]).toBe(n === 3 ? 0 : 3)
    expect(o.postflop[0]).toBe(1)
  })
  it("三档投入拆出主池和两个边层，单人层原额退回", () => {
    expect(
      splitPots([
        { seatNo: 0, total: 100, folded: false },
        { seatNo: 1, total: 300, folded: false },
        { seatNo: 2, total: 500, folded: false },
      ]),
    ).toEqual([
      { amount: 300, eligible: [0, 1, 2], refund: false },
      { amount: 400, eligible: [1, 2], refund: false },
      { amount: 200, eligible: [2], refund: true },
    ])
    expect(
      splitPots([
        { seatNo: 0, total: 100, folded: false },
        { seatNo: 1, total: 300, folded: false },
        { seatNo: 2, total: 300, folded: false },
      ]),
    ).toEqual([
      { amount: 300, eligible: [0, 1, 2], refund: false },
      { amount: 400, eligible: [1, 2], refund: false },
    ])
  })
  it("平局奇数余数按按钮下家方向分配，不产生小数", () =>
    expect(distribute(5, [0, 2], [1, 2, 0])).toEqual({ 0: 2, 2: 3 }))
})
describe("单手状态机", () => {
  it("单挑跟注过牌直到结算，筹码守恒且输入不可变", () => {
    let h = startHand(
      [
        { seatNo: 0, stack: 1000 },
        { seatNo: 1, stack: 1000 },
      ],
      0,
      orderedDeck(),
    )
    const original = JSON.stringify(h)
    expect(h.actionOnSeat).toBe(0)
    const next = act(h, 0, { action: "call" })
    expect(JSON.stringify(h)).toBe(original)
    h = next
    h = act(h, 1, { action: "check" })
    expect(h.street).toBe("flop")
    expect(h.actionOnSeat).toBe(1)
    while (h.street !== "settled")
      h = act(h, h.actionOnSeat!, {
        action: legalActions(h, h.actionOnSeat!).toCall ? "call" : "check",
      })
    expect(h.board).toHaveLength(5)
    expect(h.seats.reduce((s, p) => s + p.stack, 0)).toBe(2000)
  })
  it("弃牌立即结算，不发公共牌不亮牌", () => {
    const h = act(
      startHand(
        [
          { seatNo: 0, stack: 100 },
          { seatNo: 1, stack: 100 },
        ],
        0,
        orderedDeck(),
      ),
      0,
      { action: "fold" },
    )
    expect(h.street).toBe("settled")
    expect(h.board).toEqual([])
    expect(h.showdownSeats).toEqual([])
    expect(h.seats.map((p) => p.stack)).toEqual([99, 101])
  })
  it("最小加注与筹码上限，不足额全下不重开已行动者加注权", () => {
    let h = startHand(
      [
        { seatNo: 0, stack: 100 },
        { seatNo: 1, stack: 15 },
        { seatNo: 2, stack: 100 },
      ],
      0,
      orderedDeck(),
    )
    expect(() => act(h, 0, { action: "raise", to: 3 })).toThrow()
    expect(() => act(h, 0, { action: "raise", to: 101 })).toThrow()
    h = act(h, 0, { action: "raise", to: 10 })
    h = act(h, 1, { action: "allin" })
    h = act(h, 2, { action: "call" })
    expect(legalActions(h, 0).actions).not.toContain("raise")
    expect(legalActions(h, 0).actions).not.toContain("allin")
    expect(legalActions(h, 0).toCall).toBe(5)
  })
  it("等额全下自动发完公共牌，无需等待无筹码玩家", () => {
    let h = startHand(
      [
        { seatNo: 0, stack: 100 },
        { seatNo: 1, stack: 100 },
      ],
      0,
      orderedDeck(),
    )
    h = act(h, 0, { action: "allin" })
    h = act(h, 1, { action: "call" })
    expect(h.street).toBe("settled")
    expect(h.board).toHaveLength(5)
    expect(h.seats.reduce((s, p) => s + p.stack, 0)).toBe(200)
  })
})

describe("多手规则回归", () => {
  it("确定性动作序列跑完1000手，所有筹码均为非负整数且严格守恒", () => {
    let seed = 381231
    const random = (max: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed % max
    }
    for (let n = 0; n < 1000; n++) {
      const count = 2 + random(9)
      let h = startHand(
        Array.from({ length: count }, (_, seatNo) => ({ seatNo, stack: 10 + random(1000) })),
        n % count,
        shuffle(orderedDeck(), random),
      )
      const total = h.seats.reduce((sum, s) => sum + s.startingStack, 0)
      let turns = 0
      while (h.street !== "settled") {
        if (++turns > 500) throw new Error("单手未终止")
        const legal = legalActions(h, h.actionOnSeat!)
        const action = legal.actions[random(legal.actions.length)]
        h = act(h, h.actionOnSeat!, { action, to: legal.minRaiseTo })
        expect(h.seats.every((s) => Number.isInteger(s.stack) && s.stack >= 0)).toBe(true)
      }
      expect(h.seats.reduce((sum, s) => sum + s.stack, 0)).toBe(total)
    }
  }, 30000)
})
