import { expect, it } from "vitest"
import type { PokerCardChoiceSpec } from "@synapse/shared/game-contracts"
import { cardChoiceRequests, cardCandidateRequest, reconcileCardSelections, changeCardSelection } from "../lib/card-selection"

const choices: PokerCardChoiceSpec[] = [
  { key: "targetHole", label: "目标底牌", kind: "hole", options: [{ value: "1:0", label: "座位2 · 底牌1" }, { value: "2:1", label: "座位3 · 底牌2" }] },
  { key: "color", label: "猜颜色", kind: "color", options: [{ value: "red", label: "红色" }, { value: "black", label: "黑色" }] },
]
it("更换暗牌清掉下游猜色，不能提交先前目标的颜色", () => {
  expect(changeCardSelection(choices, { targetHole: "1:0", color: "red" }, "targetHole", "2:1")).toEqual({ targetHole: "2:1" })
  expect(changeCardSelection(choices, { targetHole: "1:0", color: "red" }, "color", "forged")).toEqual({ targetHole: "1:0", color: "red" })
})
it("移除撤回选项、未知字段和失去前置条件的猜色，不自动选择唯一选项", () => {
  expect(reconcileCardSelections(choices, { targetHole: "9:0", color: "red", forged: "secret" })).toEqual({})
  expect(reconcileCardSelections(choices, {})).toEqual({})
  expect(reconcileCardSelections(choices, { targetHole: "1:0", color: "black" })).toEqual({ targetHole: "1:0", color: "black" })
})
it("由领域选择映射六类前置，候选只保留真实索引且不扩充数量", () => {
  const extra: PokerCardChoiceSpec[] = [
    { key: "hole", label: "底牌", kind: "hole", options: [] },
    { key: "player", label: "玩家", kind: "player", options: [] },
    { key: "ability", label: "材料", kind: "ability", options: [] },
    { key: "status", label: "效果", kind: "status", options: [] },
  ]
  expect(cardChoiceRequests([...extra, ...choices]).map(r => r.ui)).toEqual(["own-hole", "player", "ability-material", "status", "opponent-hole", "color"])
  expect(cardCandidateRequest({ choiceId: "one", origin: "card", kind: "poker", paymentVersion: "paid", candidates: ["As"] })).toMatchObject({ ui: "poker-candidate", options: [{ value: "0", label: "候选 1" }] })
  expect(cardCandidateRequest({ choiceId: "one", origin: "card", kind: "ability", paymentVersion: "paid", candidates: ["24"] })).toMatchObject({ ui: "ability-candidate", options: [{ value: "0", label: "候选 1" }] })
})
