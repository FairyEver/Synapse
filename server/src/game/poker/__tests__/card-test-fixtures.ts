import type { CardDefinition, ResolutionContext } from "../engine/cards/types"
import { createCardPool } from "../engine/cards/pool"
import { orderedDeck } from "../engine/deck"
import { startHand, type HandState } from "../engine/hand-runner"
import type { PokerVariant } from "../engine/rules"

export function sequenceRandomInt(values: readonly number[]): (max: number) => number {
  let index = 0
  return max => {
    const value = values[index++] ?? 0
    if (!Number.isInteger(value) || value < 0 || value >= max) throw new Error("无效测试熵")
    return value
  }
}
export function cardContext(overrides: Partial<ResolutionContext> = {}): ResolutionContext {
  let id = 0
  return { handId: "test-hand", actionSeq: 1, rootActionId: "test-action", actorSeatNo: 0, actorAdmissionId: "admission-0", source: "human", nowMs: 0, randomInt: sequenceRandomInt([]), nextId: () => `${overrides.rootActionId ?? "test-action"}:instance-${++id}`, ...overrides }
}
export function makeCardHand(options: { humans?: number; bots?: number; actorSeatNo?: number; variant?: PokerVariant; bigBlind?: number; roll?: boolean; definitions?: readonly CardDefinition[] } = {}): HandState {
  const humans = options.humans ?? 2, bots = options.bots ?? 0, bigBlind = options.bigBlind ?? 2
  const variant = options.variant ?? "standard52"
  const state = startHand(Array.from({ length: humans + bots }, (_, seatNo) => ({ seatNo, stack: 1000 })), 0, orderedDeck(variant), { variant, smallBlind: bigBlind / 2, bigBlind, ...(options.roll ? { ruleOptions: { roll: true }, rollPricingVersion: "roll-v1" } : {}) })
  state.cards = createCardPool(options.definitions ?? [{ id: "test", name: "测试", description: "测试", artId: "test", copies: 90, tags: [], selections: [], steps: [] }], cardContext({ rootActionId: "initial" }))
  state.cards.participants = state.seats.map(p => ({ seatNo: p.seatNo, admissionId: `admission-${p.seatNo}`, userId: `user-${p.seatNo}`, kind: p.seatNo < humans ? "human" : "bot", folded: p.folded, allIn: p.allIn }))
  state.actionOnSeat = options.actorSeatNo ?? 0
  state.ruleOptions = { ...state.ruleOptions, cards: true }
  state.cardRulesVersion = "cards-v1"
  return state
}
