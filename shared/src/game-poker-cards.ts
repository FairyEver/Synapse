export const POKER_CARD_RULES_VERSIONS = ["cards-v1", "cards-v2"] as const
export type PokerCardRulesVersion = typeof POKER_CARD_RULES_VERSIONS[number]
export const POKER_CARD_RULES_VERSION = "cards-v2" as const
export const POKER_CHIP_RULES_VERSION = "chips-v2" as const
export const GAME_POKER_RULES_HEADER = "x-synapse-poker-rules"
export const SUPPORTED_POKER_RULES = [...POKER_CARD_RULES_VERSIONS, POKER_CHIP_RULES_VERSION] as const
export const POKER_CARD_LIMITS = { operations: 128, depth: 32, instances: 1024, effectsPerPlayer: 64, initial: 3, refill: 1, turnMs: 600000, maximumTurnMs: 1200000 } as const
export type PokerCardErrorCode = "POKER_CARD_MODE_UNAVAILABLE" | "POKER_CARD_AI_DISABLED" | "POKER_CARD_VERSION_UNSUPPORTED" | "POKER_CARD_CHOICE_REQUIRED" | "POKER_CARD_PRICE_CHANGED" | "POKER_CARD_BUDGET_EXCEEDED" | "POKER_CARD_INVALID_SELECTION"
export type PokerCardStreet = "preflop" | "flop" | "turn" | "river"
export interface PokerPaymentView { nominalAmount: number; waivedAmount: number; paidAmount: number; version: string }
export interface PokerCardWriteInput {
  roomCode: string; handId: string; street: PokerCardStreet; expectedActionSeq: number; controlVersion: number
  actionId: string; expectedPaymentVersion: string
}
export interface PokerCardPlayInput extends PokerCardWriteInput { instanceId: string; selections: Record<string, string | number> }
export interface PokerCardChooseInput extends PokerCardWriteInput { choiceId: string; candidateIndex: number }
export interface PokerCardResult { ok: true; handId: string; actionSeq: number; cursor: string; status: "completed" | "choice_required" | "blocked" }
export interface PokerCardPlayPolicy { cancelUntil: "target-confirm" | "never"; result: "table" | "holes" | "intel"; candidates?: number }
export interface PokerCardDefinitionView { id: string; name: string; description: string; artId: string; cost: number; consumeSelected?: boolean; play?: PokerCardPlayPolicy }
export interface PokerCardChoiceSpec { key: string; label: string; kind: "hole" | "player" | "ability" | "status" | "color"; options: { value: string; label: string }[] }
export interface PokerCardHandView { instanceId: string; cardId: string; available: boolean; reason?: string; payment: PokerPaymentView; choices: PokerCardChoiceSpec[] }
export interface PokerCardStatusView {
  id: string; cardId: string; title: string; polarity: "positive" | "negative" | "neutral"
  seatNo?: number; remaining?: number; expiresAt?: number; expiresStreet?: string; dispellable: boolean
}
export interface PokerCardPendingView {
  choiceId: string; kind: "poker" | "ability"; origin: "roll" | "card"; paymentVersion: string
  sourceCardId?: string; cardIndex?: number; candidates: string[]; candidateCards?: PokerCardDefinitionView[]
}
export interface PokerCardPrivateResultView {
  id: string; cardId: string; label: string; values: string[]; valid: boolean
  /** Only for the observer's complete view of another seat's hole cards. */
  targetSeatNo?: number
}
export interface PokerCardView {
  enabled: boolean; version: PokerCardRulesVersion
  definitions?: Record<string, PokerCardDefinitionView>
  ownHand?: PokerCardHandView[]; pending?: PokerCardPendingView | null
  used: { id: string; cardId: string; name: string; seatNo: number; seq: number; status: "completed" | "blocked" | "choice_required"; artId?: string; description?: string }[]
  statuses: PokerCardStatusView[]
  privateResults?: PokerCardPrivateResultView[]
}
export interface PokerResolutionEventView {
  index: number; type: string; actorSeatNo?: number; targetSeatNo?: number; cardId?: string
  amount?: number; nominalAmount?: number; waivedAmount?: number; status?: string; cards?: string[]
  color?: "red" | "black"; matched?: boolean; count?: number
}
export interface PokerResolutionFrameView { id: string; handId: string; seq: number; events: PokerResolutionEventView[] }
export function supportsPokerCardRules(value: string | undefined, required: PokerCardRulesVersion = POKER_CARD_RULES_VERSION): boolean {
  if (!value || value.length > 256) return false
  const versions = new Set(value.split(",").map(v => v.trim()))
  return versions.has(required) && versions.has(POKER_CHIP_RULES_VERSION)
}
