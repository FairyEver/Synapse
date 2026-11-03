import { describe, expect, it } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { planPokerCardMotion } from "../lib/table-card-motion"
import { cardTable } from "./card-stage-fixture"

function table(): PokerTableView {
  const view = structuredClone(cardTable)
  view.cards!.version = "cards-v2"
  return view
}

describe("牌桌动画读取已确认的变化", () => {
  it("普通房按座位发两圈牌，翻牌时只发新增公共牌", () => {
    const current = { ...table(), cards: undefined, board: [], street: "preflop" as const, handNo: 2, dealerSeat: 1 }
    const previous = { ...current, handId: null, handNo: 1 }
    expect(planPokerCardMotion(previous, current)?.deals).toEqual(["hole:0:0", "hole:1:0", "hole:0:1", "hole:1:1"])
    expect(planPokerCardMotion(current, { ...current, actionSeq: 4, board: ["Ac", "3s", "5d"] })?.deals).toEqual(["board:0", "board:1", "board:2"])
  })

  it("对手的公开换牌只有座位和张数，重复快照不重播", () => {
    const previous = table(), current = table()
    current.actionSeq = 4
    current.handLog = { handId: current.handId!, complete: true, entries: [
      { action: "card", seatNo: 1, displayName: "对手", seq: 4, street: "flop", amount: 0, isAuto: false,
        effects: [{ kind: "exchanged", target: { seatNo: 0, displayName: "我" }, count: 1 }] },
    ] }
    expect(planPokerCardMotion(previous, current)?.changes).toEqual([{ kind: "exchanged", seats: [1, 0], count: 1 }])
    expect(planPokerCardMotion(current, structuredClone(current))).toBeNull()
    expect(planPokerCardMotion(current, previous)).toBeNull()
  })

  it("公开施放与实付筹码关联，本人抽牌按实例识别，旁观没有抽牌身份", () => {
    const previous = table(), current = table()
    current.actionSeq = 4
    current.cards!.used = [{ id: "used", cardId: "22", name: "灵感迸发", seatNo: 0, seq: 4, status: "completed" }]
    current.cards!.ownHand = [{ ...current.cards!.ownHand![0], instanceId: "new-copy" }]
    current.chipState = { pot: [], roll: [], recent: [
      { id: "payment", seq: 4, seatNo: 0, amount: 2, fund: "pot", kind: "card" },
      { id: "waived", seq: 4, seatNo: 0, amount: 0, fund: "pot", kind: "card" },
      { id: "bet", seq: 4, seatNo: 0, amount: 3, fund: "pot", kind: "bet" },
    ] }
    expect(planPokerCardMotion(previous, current)).toMatchObject({ casts: [{ id: "used" }], payments: ["payment"], draws: ["new-copy"] })
    delete previous.cards!.ownHand
    delete current.cards!.ownHand
    expect(planPokerCardMotion(previous, current)?.draws).toEqual([])
  })
})
