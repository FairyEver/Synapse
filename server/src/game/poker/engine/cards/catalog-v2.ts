import { createHash } from "node:crypto"
import { CARD_CATALOG_V1 } from "./catalog-v1"
import { step } from "./catalog/definition"
import { CardRegistry } from "./registry"
import type { CardDefinition } from "./types"

function revise(id: string, changes: Partial<CardDefinition> & { description: string; play: NonNullable<CardDefinition["play"]> }): CardDefinition {
  const previous = CARD_CATALOG_V1.find(card => card.id === id)
  if (!previous) throw new Error("POKER_CARD_INVALID_REGISTRATION")
  return { ...previous, copies: 8, ...changes }
}

const definitions = [
  revise("01", {
    description: "指定一张底牌，从牌堆随机抽一张替换。",
    replacement: { tier: "normal", halfUnits: 2, draws: 1 },
    play: { cancelUntil: "target-confirm", result: "holes" },
  }),
  revise("02", {
    description: "随机抽两张新牌，替换你的两张底牌。",
    replacement: { tier: "normal", halfUnits: 4, draws: 2 },
    steps: [step("poker.reset", { seatNo: "$self", excludeOld: true })],
    play: { cancelUntil: "never", result: "table" },
  }),
  revise("06", {
    description: "指定一张底牌，从三张随机候选中选一张替换。",
    replacement: { tier: "super", halfUnits: 2, draws: 3 },
    steps: [step("poker.replace", { seatNo: "$self", cardIndex: "$hole", mode: "candidates", candidateCount: 3, paymentVersion: "$payment" })],
    play: { cancelUntil: "target-confirm", candidates: 3, result: "holes" },
  }),
  revise("07", {
    name: "五选其一",
    description: "随机锁定一张底牌，从五张随机候选中选一张替换。",
    selections: [],
    replacement: { tier: "super", halfUnits: 3, draws: 5 },
    steps: [step("poker.replace", { seatNo: "$self", mode: "candidates", candidateCount: 5, paymentVersion: "$payment" })],
    play: { cancelUntil: "never", candidates: 5, result: "holes" },
  }),
  revise("11", {
    description: "私下查看下一张公共牌。牌序改变后情报失效。",
    play: { cancelUntil: "never", result: "intel" },
  }),
  revise("14", {
    description: "私下查看一名未弃牌对手的两张底牌。",
    play: { cancelUntil: "target-confirm", result: "intel" },
  }),
  revise("22", {
    description: "从共享牌池抽两张能力牌。",
    requirements: ["candidate_pool"],
    play: { cancelUntil: "never", result: "table" },
  }),
  revise("48", {
    description: "阻止下一张以你为唯一目标的敌对能力牌。",
    requirements: ["inactive_counter"],
    play: { cancelUntil: "never", result: "table" },
  }),
]

export const CARD_CATALOG_V2_SNAPSHOT = Object.freeze({
  version: "cards-v2",
  operationVersion: "card-operations-v2",
  digest: createHash("sha256").update(JSON.stringify(definitions)).digest("hex"),
  recipe: definitions.map(card => ({ id: card.id, copies: card.copies! })),
})

export function createCardRegistryV2(): CardRegistry {
  if (CARD_CATALOG_V2_SNAPSHOT.digest !== "8b0ed5666c84f35babb5f07a7b1066fdae259c813fc10b82c17589dd7d6cc430") throw new Error("POKER_CARD_VERSION_UNSUPPORTED")
  return new CardRegistry(definitions)
}
