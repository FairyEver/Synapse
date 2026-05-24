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

export class KnowledgeBaseHotCacheStateStore {
  private readonly states = new Map<string, KnowledgeBaseHotCacheState>()

  async shouldInject(input: KnowledgeBaseHotCacheShouldInjectInput): Promise<boolean> {
    const state = this.states.get(input.conversationId)
    if (!state) return true
    if (state.hotHash !== input.hotHash) return true
    return input.nowMs - state.injectedAtMs >= input.staleAfterMs
  }

  async markInjected(state: KnowledgeBaseHotCacheState): Promise<void> {
    this.states.set(state.conversationId, state)
  }
}
