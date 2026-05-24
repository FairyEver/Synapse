import type { KnowledgeBaseSkippedSource, KnowledgeBaseSourceScanItem } from "./source-scan"
import type { WikiSnapshot } from "./wiki-snapshot"

export interface KnowledgeBaseIngestTurnState {
  readonly projectPath: string
  readonly generatedAt: string
  readonly force: boolean
  readonly changedSources: readonly KnowledgeBaseSourceScanItem[]
  readonly skippedSources: readonly KnowledgeBaseSkippedSource[]
  readonly wikiBefore: WikiSnapshot
}

export type KnowledgeBaseIngestTurnRecord =
  | { readonly kind: "preflight"; readonly state: KnowledgeBaseIngestTurnState }
  | { readonly kind: "no-finalize"; readonly reason: "direct-result" }

export class KnowledgeBaseIngestTurnStore {
  private readonly states = new Map<string, KnowledgeBaseIngestTurnRecord>()

  set(turnId: string, state: KnowledgeBaseIngestTurnState): void {
    this.states.set(turnId, { kind: "preflight", state })
  }

  setNoFinalize(turnId: string, reason: "direct-result"): void {
    this.states.set(turnId, { kind: "no-finalize", reason })
  }

  consume(turnId: string): KnowledgeBaseIngestTurnRecord | null {
    const state = this.states.get(turnId)
    if (!state) return null
    this.states.delete(turnId)
    return state
  }

  clear(turnId: string): void {
    this.states.delete(turnId)
  }
}
