import type { ActionKind, Decision } from "./engine/betting"
import { evaluate } from "./engine/hand"

export interface BotDecisionInput {
  hole: string[]
  board: string[]
  pot: number
  stack: number
  streetBet: number
  legal: { actions: ActionKind[]; toCall: number; minRaiseTo: number; maxRaiseTo: number }
}
/** Only the acting bot's cards and public numbers cross this boundary. */
export function chooseBotAction(input: BotDecisionInput, random: number): Decision {
  const { legal, hole, board } = input
  if (!legal.actions.length) throw new Error("Bot has no legal action")
  const strong = board.length >= 3
    ? evaluate([...hole, ...board]).category >= 2
    : hole[0]?.[0] === hole[1]?.[0] || hole.every((c) => "TJQKA".includes(c[0]))
  const raise = legal.actions.includes("raise") ? "raise" : legal.actions.includes("bet") ? "bet" : null
  if (raise && random < (strong ? 0.12 : 0.02) && legal.minRaiseTo <= Math.min(legal.maxRaiseTo, input.streetBet + Math.max(4, Math.floor(input.pot / 3))))
    return { action: raise, to: legal.minRaiseTo }
  if (legal.actions.includes("check")) return { action: "check" }
  if (legal.actions.includes("call") && legal.toCall <= Math.max(2, Math.floor(input.pot * (strong ? 0.8 : 0.35))))
    return { action: "call" }
  return { action: "fold" }
}
