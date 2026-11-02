import type { z } from "zod"
import type { CardDefinition, DomainOperation, EffectInstance, LifecycleEvent, OperationApi } from "./types"
import { CardRuleError } from "./types"

interface RegisteredOperation<S> { apply(state: S, input: unknown, api: OperationApi): void }
export interface LifecycleHook<S> {
  kind: string; event: string; phase: "before" | "after"; priority: number
  when?(state: S, effect: EffectInstance, event: LifecycleEvent): boolean
  apply(state: S, effect: EffectInstance, event: LifecycleEvent, api: OperationApi): boolean
}
export class OperationRegistry<S> {
  private readonly operations = new Map<string, RegisteredOperation<S>>()
  private readonly hooks: LifecycleHook<S>[] = []
  constructor(private readonly ports: { effects?: (state: S) => EffectInstance[] } = {}) {}
  register<P>(definition: { id: string; schema: z.ZodType<P>; apply(state: S, input: P, api: OperationApi): void }): void {
    if (!definition.id || this.operations.has(definition.id)) throw new CardRuleError("POKER_CARD_INVALID_REGISTRATION")
    this.operations.set(definition.id, { apply: (state, input, api) => {
      const parsed = definition.schema.safeParse(input)
      if (!parsed.success) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
      definition.apply(state, parsed.data, api)
    } })
  }
  registerHook(hook: LifecycleHook<S>): void {
    if (this.hooks.some(h => h.kind === hook.kind && h.event === hook.event && h.phase === hook.phase)) throw new CardRuleError("POKER_CARD_INVALID_REGISTRATION")
    this.hooks.push(hook)
  }
  effects(state: S): EffectInstance[] { return this.ports.effects?.(state) ?? [] }
  matching(state: S, event: LifecycleEvent): { effect: EffectInstance; hook: LifecycleHook<S> }[] {
    return this.effects(state).filter(e => e.remaining === null || e.remaining > 0).flatMap(effect => this.hooks
      .filter(h => h.kind === effect.kind && (h.event === event.type || h.event === "*") && h.phase === event.phase)
      .map(hook => ({ effect, hook })))
      .sort((a, b) => a.hook.priority - b.hook.priority || a.effect.installedSeq - b.effect.installedSeq || a.effect.id.localeCompare(b.effect.id))
  }
  apply(state: S, operation: DomainOperation, api: OperationApi): void {
    const definition = this.operations.get(operation.type)
    if (!definition) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
    definition.apply(state, operation.input, api)
  }
}
export class CardRegistry {
  private readonly entries = new Map<string, CardDefinition>()
  constructor(definitions: readonly CardDefinition[]) {
    for (const definition of definitions) {
      const copies = definition.copies ?? 1
      if (!definition.id || this.entries.has(definition.id) || !Number.isSafeInteger(copies) || copies < 1 || copies > 1024 || !Number.isSafeInteger(definition.costBB ?? 0) || (definition.costBB ?? 0) < 0)
        throw new CardRuleError("POKER_CARD_INVALID_REGISTRATION")
      this.entries.set(definition.id, structuredClone(definition))
    }
  }
  get(id: string): CardDefinition {
    const definition = this.entries.get(id)
    if (!definition) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
    return structuredClone(definition)
  }
  all(): CardDefinition[] { return [...this.entries.values()].map(d => structuredClone(d)) }
}
