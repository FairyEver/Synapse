import { AGENT_HISTORY_RECORD_BYTES } from "../../../../config"
import { z } from "zod"
import type { DataSqliteSchema, NamespaceSchema } from "../types"

const identity = { id: z.string().min(1), schemaVersion: z.literal(1), projectId: z.string().min(1), conversationId: z.string().min(1) }
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const contentRef = z.object({ contentId: z.string().min(1), version: revision, sha256: hash, bytes: revision, utf16Length: revision }).strict()

export const conversationSummaryV2Schema = z.object({ ...identity,
  storageVersion: z.literal(2), storageEpoch: z.string().min(1), name: z.string(),
  historyCount: revision, lastHistorySeq: revision, commitRevision: revision,
  createdAt: z.string(), updatedAt: z.string(), activeGeneration: revision,
  runId: z.string().optional(), taskListId: z.string().optional(), configRef: contentRef.optional(),
}).strict()
export type ConversationSummaryV2 = z.infer<typeof conversationSummaryV2Schema>

export const historyRecordSchema = z.object({ ...identity,
  entryId: z.string().min(1), seq: revision.positive(), turnId: z.string().min(1), generation: revision,
  role: z.enum(["user", "assistant", "system", "tool"]), timestamp: z.string(),
  toolUseId: z.string().optional(), requestId: z.string().optional(), preview: z.string(),
  contentRef, metadataRef: contentRef.optional(), createdRevision: revision.positive(),
}).strict()
export type HistoryRecord = z.infer<typeof historyRecordSchema>
export type HistoryContentRef = z.infer<typeof contentRef>

export const historyRevisionSchema = z.object({ ...identity,
  entryId: z.string().min(1), revision: revision.positive(), metadataRef: contentRef,
}).strict()
export type HistoryRecordRevision = z.infer<typeof historyRevisionSchema>

export const historyContentSchema = z.object({ ...identity,
  contentId: z.string().min(1), version: revision, state: z.enum(["staging", "committed", "orphan"]),
  sha256: hash, bytes: revision, utf16Length: revision, chunkCount: revision,
}).strict()
export type HistoryContentManifest = z.infer<typeof historyContentSchema>

export const historyChunkSchema = z.object({ ...identity,
  contentId: z.string().min(1), version: revision, ordinal: revision,
  byteStart: revision, bytes: revision, utf16Start: revision, utf16Length: revision,
  sha256: hash, artifactId: z.string().min(1),
}).strict()
export type HistoryContentChunk = z.infer<typeof historyChunkSchema>

export const historyReceiptSchema = z.object({ ...identity,
  operationId: z.string().min(1), payloadHash: hash, entryId: z.string().min(1),
  seq: revision.positive(), commitRevision: revision.positive(),
}).strict()
export type HistoryAppendReceipt = z.infer<typeof historyReceiptSchema>

export const historyTurnSchema = z.object({ ...identity,
  turnId: z.string().min(1), firstSeq: revision.positive(), lastSeq: revision.positive(), projectionBytes: revision,
}).strict()
export type HistoryTurnIndex = z.infer<typeof historyTurnSchema>

function collection<S extends z.ZodRawShape>(name: string, validator: z.ZodObject<S>, indexes: DataSqliteSchema<z.infer<z.ZodObject<S>>>["indexes"]): NamespaceSchema<z.infer<z.ZodObject<S>>> {
  return { name, backend: "sqlite", currentVersion: 1, migrations: [],
    validate: (value): value is z.infer<z.ZodObject<S>> => validator.safeParse(value).success,
    sqlite: { atomic: true, maxRecordBytes: AGENT_HISTORY_RECORD_BYTES, fields: Object.keys(validator.shape) as Extract<keyof z.infer<z.ZodObject<S>>, string>[], indexes },
  }
}

// Explicitly registered by isolated V2 consumers until migration/backup acceptance permits cutover.
export const historySummaryNamespace = collection("agent.history-summaries", conversationSummaryV2Schema, [
  { name: "scope", fields: ["projectId", "conversationId"], unique: true },
])
export const historyRecordNamespace = collection("agent.history-records", historyRecordSchema, [
  { name: "scope_seq", fields: ["projectId", "conversationId", "seq"], unique: true },
  { name: "scope_entry", fields: ["projectId", "conversationId", "entryId"], unique: true },
  { name: "scope_turn_seq", fields: ["projectId", "conversationId", "turnId", "seq"], unique: true },
  { name: "scope_tool", fields: ["projectId", "conversationId", "toolUseId", "seq"] },
  { name: "scope_request", fields: ["projectId", "conversationId", "requestId", "seq"] },
])
export const historyRevisionNamespace = collection("agent.history-revisions", historyRevisionSchema, [
  { name: "scope_entry_revision", fields: ["projectId", "conversationId", "entryId", "revision"], unique: true },
])
export const historyContentNamespace = collection("agent.history-content", historyContentSchema, [
  { name: "scope_content", fields: ["projectId", "conversationId", "contentId", "version"], unique: true },
])
export const historyChunkNamespace = collection("agent.history-chunks", historyChunkSchema, [
  { name: "scope_content_ordinal", fields: ["projectId", "conversationId", "contentId", "version", "ordinal"], unique: true },
  { name: "scope_content_offset", fields: ["projectId", "conversationId", "contentId", "version", "utf16Start"], unique: true },
])
export const historyReceiptNamespace = collection("agent.history-receipts", historyReceiptSchema, [
  { name: "scope_operation", fields: ["projectId", "conversationId", "operationId"], unique: true },
])
export const historyTurnNamespace = collection("agent.history-turns", historyTurnSchema, [
  { name: "scope_turn", fields: ["projectId", "conversationId", "turnId"], unique: true },
])
export const agentHistorySchemas = [historySummaryNamespace, historyRecordNamespace, historyRevisionNamespace,
  historyContentNamespace, historyChunkNamespace, historyReceiptNamespace, historyTurnNamespace] as const
