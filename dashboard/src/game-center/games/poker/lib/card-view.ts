import type { PokerCardHandView, PokerCardPlayInput, PokerTableView } from "@synapse/shared/game-contracts"

export function validCardSelections(card: PokerCardHandView, values: Record<string, string | number>): boolean {
  return Object.keys(values).length === card.choices.length && card.choices.every(choice => choice.options.some(option => option.value === String(values[choice.key])))
}
export function cardPlayInput(table: PokerTableView, card: PokerCardHandView, selections: Record<string, string | number>): PokerCardPlayInput {
  if (!table.handId || !["preflop", "flop", "turn", "river"].includes(table.street ?? "") || table.controlVersion == null || !validCardSelections(card, selections)) throw new Error("请选择有效目标")
  return { roomCode: table.roomCode, handId: table.handId, street: table.street as PokerCardPlayInput["street"], expectedActionSeq: table.actionSeq ?? 0, controlVersion: table.controlVersion, actionId: crypto.randomUUID(), instanceId: card.instanceId, selections: { ...selections }, expectedPaymentVersion: card.payment.version }
}
const reasons: Record<string, string> = { POKER_NOT_YOUR_TURN: "等待你的回合", POKER_ACTION_EXPIRED: "本回合已超时", POKER_CARD_CHOICE_REQUIRED: "请先完成待选", POKER_CARD_INSUFFICIENT_STACK: "筹码不足，须保留至少 1 筹码", POKER_CARD_INVALID_SELECTION: "暂无合法目标", POKER_CARD_REQUIREMENT_UNMET: "当前条件不满足" }
export const cardUnavailableReason = (reason?: string) => reason ? reasons[reason] ?? "当前条件不满足" : null
