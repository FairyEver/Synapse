import type { NamespaceSchema } from "../types"

/** Immutable, bounded journal rows; never embedded in conversation.history. */
export interface AgentTaskProgressEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  projectId: string
  conversationId: string
  turnId: string
  revision: number
  generationId?: string
  kind: "receipt" | "presentation" | "commit" | "assessment"
  data: Record<string, unknown>
}

export const agentTaskProgressSchema: NamespaceSchema<AgentTaskProgressEntryV1> = {
  name: "agent.task-progress", backend: "sqlite", currentVersion: 1, migrations: [],
  sqlite: {
    fields: ["id", "projectId", "conversationId", "turnId", "revision"], maxRecordBytes: 64 * 1024, atomic: false,
    indexes: [{ name: "turn_revision", fields: ["projectId", "conversationId", "turnId", "revision"] }],
  },
  validate(value): value is AgentTaskProgressEntryV1 {
    if (!value || typeof value !== "object") return false
    const row = value as AgentTaskProgressEntryV1
    return row.schemaVersion === 1 && [row.id, row.projectId, row.conversationId, row.turnId].every((s) => typeof s === "string" && s.length > 0)
      && Number.isSafeInteger(row.revision) && row.revision > 0
      && (row.generationId === undefined || (typeof row.generationId === "string" && row.generationId.length > 0))
      && ["receipt", "presentation", "commit", "assessment"].includes(row.kind)
      && Boolean(row.data && typeof row.data === "object" && !Array.isArray(row.data))
      && Buffer.byteLength(JSON.stringify(value)) <= 64 * 1024
  },
}
