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
  it("普通房的发牌和亮牌交给牌桌原有的动画", () => {
    const previous = { ...table(), cards: undefined, board: [] }
    expect(planPokerCardMotion(previous, { ...previous, board: ["Ac", "3s", "5d"], actionSeq: 4 })).toBeNull()
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

  it("只为本人保留被换掉的旧牌，并用真实变化定位底牌槽", () => {
    const previous = table(), current = table()
    current.actionSeq = 4
    current.hole = ["As", "7h"]
    current.handLog = { handId: current.handId!, complete: true, entries: [
      { action: "card", seatNo: 0, displayName: "我", seq: 4, street: "flop", amount: 0, isAuto: false,
        effects: [{ kind: "replaced", target: { seatNo: 0, displayName: "我" }, count: 1 }] },
    ] }
    expect(planPokerCardMotion(previous, current)?.changes).toEqual([
      { kind: "replaced", seats: [0], count: 1, slots: { 0: [1] }, oldCards: { 0: { 1: "Kd" } } },
    ])
    delete previous.hole
    delete current.hole
    delete previous.cards!.ownHand
    delete current.cards!.ownHand
    expect(planPokerCardMotion(previous, current)?.changes).toEqual([{ kind: "replaced", seats: [0], count: 1 }])
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
