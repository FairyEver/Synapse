import type { DataNamespace } from "../../runtime/data-repo"
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

export interface KnowledgeBasePendingIngestRecovery {
  readonly projectPath: string
  readonly conversationId: string
  readonly turnId: string
  readonly failedAt: string
  readonly warningCodes: readonly string[]
  readonly assistantText: string
  readonly preflight: KnowledgeBaseIngestTurnState
}

export type KnowledgeBaseIngestTurnStoreEntry =
  | {
    readonly id: string
    readonly schemaVersion: 1
    readonly entryType: "turn"
    readonly turnId: string
    readonly record: KnowledgeBaseIngestTurnRecord
  }
  | {
    readonly id: string
    readonly schemaVersion: 1
    readonly entryType: "recovery"
    readonly turnId: string
    readonly recovery: KnowledgeBasePendingIngestRecovery
  }

export class KnowledgeBaseIngestTurnStore {
  private readonly namespace: DataNamespace<KnowledgeBaseIngestTurnStoreEntry> | undefined
  private readonly states = new Map<string, KnowledgeBaseIngestTurnRecord>()
  private readonly pendingRecoveries = new Map<string, KnowledgeBasePendingIngestRecovery>()

  constructor(deps: { readonly namespace?: DataNamespace<KnowledgeBaseIngestTurnStoreEntry> } = {}) {
    this.namespace = deps.namespace
  }

  async set(turnId: string, state: KnowledgeBaseIngestTurnState): Promise<void> {
    const record: KnowledgeBaseIngestTurnRecord = { kind: "preflight", state }
    this.states.set(turnId, record)
    await this.namespace?.upsert({ id: turnEntryId(turnId), schemaVersion: 1, entryType: "turn", turnId, record })
  }

  async setNoFinalize(turnId: string, reason: "direct-result"): Promise<void> {
    const record: KnowledgeBaseIngestTurnRecord = { kind: "no-finalize", reason }
    this.states.set(turnId, record)
    await this.namespace?.upsert({ id: turnEntryId(turnId), schemaVersion: 1, entryType: "turn", turnId, record })
  }

  async get(turnId: string): Promise<KnowledgeBaseIngestTurnRecord | null> {
    const state = this.states.get(turnId)
    if (state) return state
    const entry = await this.namespace?.get(turnEntryId(turnId))
    return entry?.entryType === "turn" ? entry.record : null
  }

  async consume(turnId: string): Promise<KnowledgeBaseIngestTurnRecord | null> {
    const state = await this.get(turnId)
    if (!state) return null
    this.states.delete(turnId)
    await this.namespace?.remove(turnEntryId(turnId))
    return state
  }

  async setPendingRecovery(recovery: KnowledgeBasePendingIngestRecovery): Promise<void> {
    this.pendingRecoveries.set(recovery.turnId, recovery)
    await this.namespace?.upsert({
      id: recoveryEntryId(recovery.turnId),
      schemaVersion: 1,
      entryType: "recovery",
      turnId: recovery.turnId,
      recovery,
    })
  }

  async getPendingRecovery(turnId: string): Promise<KnowledgeBasePendingIngestRecovery | null> {
    const recovery = this.pendingRecoveries.get(turnId)
    if (recovery) return recovery
    const entry = await this.namespace?.get(recoveryEntryId(turnId))
    return entry?.entryType === "recovery" ? entry.recovery : null
  }

  async clearPendingRecovery(turnId: string): Promise<void> {
    this.pendingRecoveries.delete(turnId)
    await this.namespace?.remove(recoveryEntryId(turnId))
  }

  async clear(turnId: string): Promise<void> {
    this.states.delete(turnId)
    this.pendingRecoveries.delete(turnId)
    await Promise.all([
      this.namespace?.remove(turnEntryId(turnId)),
      this.namespace?.remove(recoveryEntryId(turnId)),
    ])
  }
}

function turnEntryId(turnId: string): string {
  return `turn:${turnId}`
}

function recoveryEntryId(turnId: string): string {
  return `recovery:${turnId}`
}
