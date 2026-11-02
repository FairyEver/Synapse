import type { GameReserveWriteBatch } from "@synapse/shared/game-contracts"
import type { HandState } from "../hand-runner"
import type { PokerCardChoiceSpec } from "@synapse/shared/game-contracts"

export type Audience = "public" | "owner" | "internal"
export interface ResolutionContext {
  handId: string; actionSeq: number; rootActionId: string; actorSeatNo: number | null; actorAdmissionId: string | null
  source: "human" | "rules_bot" | "timeout" | "system"; nowMs: number
  randomInt: (max: number) => number; nextId: () => string
}
export interface DomainOperation { type: string; input: Record<string, unknown>; audience?: Audience; ownerAdmissionId?: string; cardId?: string }
export interface LifecycleEvent {
  id: string; index: number; type: string; phase: "before" | "after"; data: Record<string, unknown>
  audience: Audience; ownerAdmissionId?: string; actorSeatNo: number | null; cardId?: string
  parentId?: string; status?: "completed" | "blocked"
}
export interface ResolutionFrame { id: string; handId: string; seq: number; rootActionId: string; events: LifecycleEvent[] }
export interface PendingChoice {
  id: string; kind: "poker" | "ability"; origin: "roll" | "card"; ownerAdmissionId: string; ownerSeatNo: number
  handId: string; street: string; sourceActionSeq: number; sourceCardId?: string; sourceInstanceId?: string
  paymentVersion: string; candidates: string[]; cardIndex?: number
}
export interface EffectInstance {
  id: string; kind: string; cardId: string; sourceInstanceId?: string; ownerAdmissionId: string; ownerSeatNo: number
  targetSeatNo?: number; polarity: "positive" | "negative" | "neutral"; installedSeq: number
  remaining: number | null; dispellable: boolean; expiresStreet?: string; expiresTurn?: number
  data: Record<string, unknown>
}
export interface CardSelectionDefinition {
  key: string; label: string; kind: PokerCardChoiceSpec["kind"]
  target?: "other_alive" | "other_human" | "own_negative" | "public_effect" | "own_other_ability" | "other_hidden_hole"
}
export interface CardDefinition {
  id: string; name: string; description: string; artId: string; copies?: number; costBB?: number
  tags: readonly string[]; selections: readonly CardSelectionDefinition[]; steps: readonly DomainOperation[]
  excludeRiver?: boolean; ignoreSurcharges?: boolean
  consumeSelected?: boolean
  requirements?: readonly ("deck" | "candidate_pool" | "target_holds_ability" | "stealable" | "recent_deposit")[]
}
export interface ResolutionResult<S> { state: S; frame: ResolutionFrame; reserveBatch?: GameReserveWriteBatch; pending?: PendingChoice }
export type HandResolution = ResolutionResult<HandState>
export interface OperationApi {
  readonly context: ResolutionContext; readonly operation: DomainOperation
  emit(type: string, data: Record<string, unknown>, audience?: Audience, dedupeKey?: string, ownerAdmissionId?: string): void
  enqueue(operation: DomainOperation): void
  replaceInput(input: Record<string, unknown>): void
  block(): void
}
export class CardRuleError extends Error {
  constructor(readonly code: string) { super(code); this.name = "CardRuleError" }
}
