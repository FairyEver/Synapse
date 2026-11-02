import { POKER_CARD_LIMITS } from "@synapse/shared/game-contracts"
import type { OperationRegistry } from "./registry"
import { CardRuleError, type DomainOperation, type LifecycleEvent, type OperationApi, type ResolutionContext, type ResolutionResult } from "./types"

/** Trusted, registered operators mutate only this transaction's private working copy. */
export function runResolution<S>(input: S, operations: readonly DomainOperation[], context: ResolutionContext, registry: OperationRegistry<S>): ResolutionResult<S> {
  const state = structuredClone(input)
  const frame = { id: `${context.handId}:${context.actionSeq}`, handId: context.handId, seq: context.actionSeq, rootActionId: context.rootActionId, events: [] as LifecycleEvent[] }
  const queue = operations.map(op => ({ operation: structuredClone(op), depth: 1, parentId: undefined as string | undefined }))
  const seenFacts = new Set<string>(), seenHooks = new Set<string>()
  let count = 0, dispatchDepth = 0
  while (queue.length) {
    const item = queue.shift()!
    if (++count > POKER_CARD_LIMITS.operations || item.depth > POKER_CARD_LIMITS.depth) throw new CardRuleError("POKER_CARD_BUDGET_EXCEEDED")
    const operation = item.operation
    const children: typeof queue = []
    let blocked = false
    let phase: "before" | "apply" | "after" = "apply"
    const operationId = `${context.rootActionId}:op${count}`
    const api: OperationApi = {
      context, operation,
      enqueue(op) { children.push({ operation: structuredClone(op), depth: item.depth + Math.max(1, dispatchDepth), parentId: operationId }) },
      replaceInput(value) { if (phase !== "before") throw new CardRuleError("POKER_CARD_INVALID_PHASE"); operation.input = structuredClone(value) },
      block() { if (phase !== "before") throw new CardRuleError("POKER_CARD_INVALID_PHASE"); blocked = true },
      emit(type, data, audience = "internal", dedupeKey, ownerAdmissionId) {
        const id = dedupeKey ? `${context.rootActionId}:${dedupeKey}` : `${context.rootActionId}:e${frame.events.length}`
        if (seenFacts.has(id)) return
        if (frame.events.length >= 1024 || dispatchDepth + item.depth > POKER_CARD_LIMITS.depth) throw new CardRuleError("POKER_CARD_BUDGET_EXCEEDED")
        seenFacts.add(id)
        const event: LifecycleEvent = { id, index: frame.events.length, type, phase: "after", data: structuredClone(data), audience, ownerAdmissionId: ownerAdmissionId ?? context.actorAdmissionId ?? undefined, actorSeatNo: context.actorSeatNo, cardId: operation.cardId, parentId: item.parentId, status: blocked ? "blocked" : "completed" }
        frame.events.push(event)
        dispatchDepth++
        try { dispatch(event) } finally { dispatchDepth-- }
      },
    }
    function dispatch(event: LifecycleEvent): void {
      const previousPhase = phase
      phase = event.phase
      try {
        for (const { effect, hook } of registry.matching(state, event)) {
          const currentEvent = { ...event, data: structuredClone(event.phase === "before" ? operation.input : event.data) }
          const key = `${event.id}:${effect.id}:${event.phase}`
          if (seenHooks.has(key) || effect.remaining !== null && effect.remaining <= 0 || hook.when && !hook.when(state, effect, currentEvent)) continue
          seenHooks.add(key)
          if (hook.apply(state, effect, currentEvent, api)) {
            if (effect.remaining !== null) effect.remaining--
          }
          if (blocked && event.phase === "before") break
        }
      } finally { phase = previousPhase }
    }
    dispatch({ id: `${operationId}:before`, index: frame.events.length, type: operation.type, phase: "before", data: structuredClone(operation.input), audience: "internal", actorSeatNo: context.actorSeatNo, cardId: operation.cardId, parentId: item.parentId })
    if (!blocked) registry.apply(state, operation, api)
    api.emit(operation.type, operation.input, operation.audience, `${operationId}:fact`, operation.ownerAdmissionId)
    const effects = registry.effects(state)
    const active = effects.filter(e => e.remaining === null || e.remaining > 0)
    const counts = new Map<string, number>()
    for (const e of active) counts.set(e.ownerAdmissionId, (counts.get(e.ownerAdmissionId) ?? 0) + 1)
    if ([...counts.values()].some(n => n > POKER_CARD_LIMITS.effectsPerPlayer)) throw new CardRuleError("POKER_CARD_BUDGET_EXCEEDED")
    effects.splice(0, effects.length, ...active)
    queue.unshift(...children)
  }
  return { state, frame }
}
