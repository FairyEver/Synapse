import { POKER_CARD_LIMITS, type PokerCardRulesVersion } from "@synapse/shared/game-contracts"
import { shuffle } from "../deck"
import type { CardDefinition, EffectInstance, PendingChoice, ResolutionContext } from "./types"
import { CardRuleError } from "./types"

export interface CardInstance { id: string; definitionId: string }
export interface CardParticipant { admissionId: string; userId: string; seatNo: number; kind: "human" | "bot"; folded: boolean; allIn: boolean; active?: boolean }
export interface CardUseRecord { id: string; instanceId: string; cardId: string; seatNo: number; seq: number; status: "completed" | "blocked" | "choice_required"; paidAmount?: number; nominalAmount?: number; waivedAmount?: number }
export interface CardPrivateResult { id: string; ownerAdmissionId: string; cardId: string; label: string; values: string[]; valid: boolean; deckRevision?: number }
export interface PublicCardMarker { id: string; card: string; cardId: string; ownerAdmissionId: string; sourceInstanceId?: string; expiresStreet?: string; parentEffectId?: string; dispellable: boolean }
export interface CardModeState {
  version: PokerCardRulesVersion; initialCount: number; generatedCount: number; catalogIds: string[]
  pool: CardInstance[]; hands: Record<string, CardInstance[]>; reserved: CardInstance[]; spent: CardInstance[]
  participants: CardParticipant[]; effects: EffectInstance[]; used: CardUseRecord[]; privateResults: CardPrivateResult[]
  pending: PendingChoice | null; dealtStages: string[]; deckRevision: number
  publicMarkers?: PublicCardMarker[]
  tideUsed?: Record<string, string[]>
  catalogSnapshot?: { version: string; operationVersion: string; digest: string; recipe: { id: string; copies: number }[] }
}
export type CardPoolOperation =
  | { kind: "deal"; stage: "initial" | "flop" | "turn" | "river"; dealerSeat: number }
  | { kind: "draw"; admissionId: string; count: number }
  | { kind: "consume"; admissionId: string; instanceIds: string[] }
  | { kind: "generate"; definitionIds: string[] }
  | { kind: "reserve"; admissionId: string; count: number; choiceId: string; street: string; paymentVersion: string; sourceCardId?: string; sourceInstanceId?: string }
  | { kind: "choose"; admissionId: string; choiceId: string; index: number }
  | { kind: "clear" }
export interface CardPoolResult { state: CardModeState; drawn: CardInstance[]; generated: CardInstance[] }
export function invalidatePokerObservations(h: { cards?: CardModeState }): void {
  if (!h.cards) return
  h.cards.deckRevision++
  for (const record of h.cards.privateResults) if (record.deckRevision !== undefined) record.valid = false
}
const reject = (): never => { throw new CardRuleError("POKER_CARD_INVALID_SELECTION") }
function count(value: number): void { if (!Number.isSafeInteger(value) || value < 0 || value > POKER_CARD_LIMITS.instances) reject() }
function allInstances(state: CardModeState): CardInstance[] { return [...state.pool, ...Object.values(state.hands).flat(), ...state.reserved, ...state.spent] }
export function assertCardPoolIntegrity(state: CardModeState): void {
  const all = allInstances(state)
  if (all.length !== state.initialCount + state.generatedCount || new Set(all.map(c => c.id)).size !== all.length || all.some(c => !state.catalogIds.includes(c.definitionId))) throw new CardRuleError("POKER_CARD_STATE_INVALID")
  if (all.length > POKER_CARD_LIMITS.instances) throw new CardRuleError("POKER_CARD_BUDGET_EXCEEDED")
}
export function createCardPool(definitions: readonly CardDefinition[], context: ResolutionContext, version: PokerCardRulesVersion = "cards-v1"): CardModeState {
  const pool: CardInstance[] = [], ids = new Set<string>()
  let total = 0
  for (const definition of definitions) {
    const copies = definition.copies ?? 1
    count(copies)
    if (!definition.id || ids.has(definition.id) || copies === 0) reject()
    ids.add(definition.id)
    total += copies
  }
  if (total > POKER_CARD_LIMITS.instances) throw new CardRuleError("POKER_CARD_BUDGET_EXCEEDED")
  for (const definition of definitions) {
    for (let i = 0; i < (definition.copies ?? 1); i++) pool.push({ id: context.nextId(), definitionId: definition.id })
  }
  const state: CardModeState = { version, initialCount: pool.length, generatedCount: 0, catalogIds: [...ids], pool: shuffle(pool, context.randomInt), hands: {}, reserved: [], spent: [], participants: [], effects: [], used: [], privateResults: [], pending: null, dealtStages: [], deckRevision: 0 }
  assertCardPoolIntegrity(state)
  return state
}
export function applyCardPoolOperation(input: CardModeState, operation: CardPoolOperation, context: ResolutionContext): CardPoolResult {
  assertCardPoolIntegrity(input)
  const state = structuredClone(input), drawn: CardInstance[] = [], generated: CardInstance[] = []
  function participant(admissionId: string): CardParticipant {
    return state.participants.find(p => p.admissionId === admissionId && p.kind === "human") ?? reject()
  }
  function draw(admissionId: string, amount: number): void {
    participant(admissionId); count(amount)
    const cards = state.pool.splice(0, amount)
    ;(state.hands[admissionId] ??= []).push(...cards)
    drawn.push(...cards)
  }
  switch (operation.kind) {
    case "deal": {
      if (state.dealtStages.includes(operation.stage)) break
      const eligible = state.participants.filter(p => p.kind === "human" && (operation.stage === "initial" || !p.folded && !p.allIn && p.active !== false))
        .sort((a, b) => (a.seatNo <= operation.dealerSeat ? 1 : 0) - (b.seatNo <= operation.dealerSeat ? 1 : 0) || a.seatNo - b.seatNo)
      const times = operation.stage === "initial" ? POKER_CARD_LIMITS.initial : POKER_CARD_LIMITS.refill
      for (let i = 0; i < times; i++) for (const p of eligible) draw(p.admissionId, 1)
      state.dealtStages.push(operation.stage)
      break
    }
    case "draw": draw(operation.admissionId, operation.count); break
    case "consume": {
      participant(operation.admissionId)
      const hand = state.hands[operation.admissionId] ?? []
      if (new Set(operation.instanceIds).size !== operation.instanceIds.length || operation.instanceIds.some(id => !hand.some(c => c.id === id))) reject()
      state.spent.push(...hand.filter(c => operation.instanceIds.includes(c.id)))
      state.hands[operation.admissionId] = hand.filter(c => !operation.instanceIds.includes(c.id))
      break
    }
    case "generate": {
      if (operation.definitionIds.some(id => !state.catalogIds.includes(id))) reject()
      if (state.initialCount + state.generatedCount + operation.definitionIds.length > POKER_CARD_LIMITS.instances) throw new CardRuleError("POKER_CARD_BUDGET_EXCEEDED")
      for (const definitionId of operation.definitionIds) generated.push({ id: context.nextId(), definitionId })
      state.pool = shuffle([...state.pool, ...generated], context.randomInt)
      state.generatedCount += generated.length
      break
    }
    case "reserve": {
      const p = participant(operation.admissionId); count(operation.count)
      if (state.pending || state.reserved.length || !state.pool.length || operation.count < 1 || operation.count > 3) reject()
      state.reserved = state.pool.splice(0, operation.count)
      state.pending = { id: operation.choiceId, kind: "ability", origin: "card", ownerAdmissionId: p.admissionId, ownerSeatNo: p.seatNo, handId: context.handId, street: operation.street, sourceActionSeq: context.actionSeq, paymentVersion: operation.paymentVersion, candidates: state.reserved.map(c => c.id), sourceCardId: operation.sourceCardId, sourceInstanceId: operation.sourceInstanceId }
      break
    }
    case "choose": {
      participant(operation.admissionId)
      const pending = state.pending
      if (!pending || pending.kind !== "ability" || pending.id !== operation.choiceId || pending.ownerAdmissionId !== operation.admissionId || !Number.isInteger(operation.index) || operation.index < 0 || operation.index >= state.reserved.length) reject()
      const selected = state.reserved[operation.index]
      ;(state.hands[operation.admissionId] ??= []).push(selected)
      drawn.push(selected)
      state.pool = shuffle([...state.pool, ...state.reserved.filter(c => c.id !== selected.id)], context.randomInt)
      state.reserved = []; state.pending = null
      break
    }
    case "clear": {
      state.spent.push(...state.pool, ...Object.values(state.hands).flat(), ...state.reserved)
      state.pool = []; state.reserved = []; state.pending = null; state.effects = []
      for (const id of Object.keys(state.hands)) state.hands[id] = []
      for (const result of state.privateResults) result.valid = false
      break
    }
  }
  assertCardPoolIntegrity(state)
  return { state, drawn, generated }
}
