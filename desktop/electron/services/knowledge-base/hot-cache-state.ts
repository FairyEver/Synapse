export interface KnowledgeBaseHotCacheState {
  readonly conversationId: string
  readonly hotHash: string
  readonly injectedAtMs: number
}

export interface KnowledgeBaseHotCacheShouldInjectInput {
  readonly conversationId: string
  readonly hotHash: string
  readonly nowMs: number
  readonly staleAfterMs: number
}

export interface KnowledgeBaseHotCacheStateStoreOptions {
  readonly maxStates?: number
}

const defaultMaxHotCacheStates = 1000

export class KnowledgeBaseHotCacheStateStore {
  private readonly states = new Map<string, KnowledgeBaseHotCacheState>()
  private readonly maxStates: number

  constructor(options: KnowledgeBaseHotCacheStateStoreOptions = {}) {
    this.maxStates = Math.max(1, Math.floor(options.maxStates ?? defaultMaxHotCacheStates))
  }

  get size(): number {
    return this.states.size
  }

  shouldInject(input: KnowledgeBaseHotCacheShouldInjectInput): boolean {
    this.deleteStaleStates(input.nowMs, input.staleAfterMs)
    const state = this.states.get(input.conversationId)
    if (!state) return true
    if (state.hotHash !== input.hotHash) return true
    return input.nowMs - state.injectedAtMs >= input.staleAfterMs
  }

  markInjected(state: KnowledgeBaseHotCacheState): void {
    this.states.delete(state.conversationId)
    this.states.set(state.conversationId, state)
    this.evictOldestStates()
  }

  private deleteStaleStates(nowMs: number, staleAfterMs: number): void {
    for (const [conversationId, state] of this.states) {
      if (nowMs - state.injectedAtMs >= staleAfterMs) {
        this.states.delete(conversationId)
      }
    }
  }

  private evictOldestStates(): void {
    while (this.states.size > this.maxStates) {
      const oldestKey = this.states.keys().next().value
      if (oldestKey === undefined) return
      this.states.delete(oldestKey)
    }
  }
}
