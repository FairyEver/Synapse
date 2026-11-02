import { POKER_CARD_LIMITS } from "@synapse/shared/game-contracts"

export interface TurnClock { seatNo: number; turnId: string; startedAt: number; deadlineAt: number; reductions: Record<string, number> }
export type DeadlineOperation =
  | { kind: "start"; seatNo: number; turnId: string; bonusMs?: number; reductions?: readonly { id: string; milliseconds: number }[] }
  | { kind: "double" } | { kind: "extend"; milliseconds: number } | { kind: "restore"; effectId: string } | { kind: "end" }
function duration(n: number) {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("POKER_INVALID_DEADLINE")
}
export function applyDeadlineOperation(original: TurnClock | null, operation: DeadlineOperation, nowMs: number): TurnClock | null {
  duration(nowMs)
  if (operation.kind === "end") return null
  if (operation.kind === "start") {
    duration(operation.bonusMs ?? 0)
    let length = Math.min(POKER_CARD_LIMITS.maximumTurnMs, POKER_CARD_LIMITS.turnMs + (operation.bonusMs ?? 0))
    const reductions: Record<string, number> = {}
    for (const reduction of operation.reductions ?? []) {
      duration(reduction.milliseconds)
      if (reduction.id in reductions) throw new Error("POKER_INVALID_DEADLINE")
      const actual = Math.min(reduction.milliseconds, Math.max(0, length - 1))
      reductions[reduction.id] = actual; length -= actual
    }
    return { seatNo: operation.seatNo, turnId: operation.turnId, startedAt: nowMs, deadlineAt: nowMs + length, reductions }
  }
  if (!original || nowMs < original.startedAt) throw new Error("POKER_INVALID_DEADLINE")
  if (nowMs >= original.deadlineAt) throw new Error("POKER_ACTION_EXPIRED")
  const clock = structuredClone(original)
  const extra = operation.kind === "double" ? clock.deadlineAt - nowMs : operation.kind === "extend" ? operation.milliseconds : clock.reductions[operation.effectId] ?? 0
  duration(extra)
  clock.deadlineAt = Math.min(clock.startedAt + POKER_CARD_LIMITS.maximumTurnMs, clock.deadlineAt + extra)
  if (operation.kind === "restore") delete clock.reductions[operation.effectId]
  return clock
}
