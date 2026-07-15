import path from "node:path"
import { mkdirSync } from "node:fs"

import { EncryptedJsonNamespace, type SafeStorage } from "./backends/encrypted-json"
import { JsonNamespace } from "./backends/json"
import { JsonLinesNamespace } from "./backends/jsonl"
import { openSqliteDatabase, SqliteNamespace } from "./backends/sqlite"
import { DataRepositoryImpl } from "./repository"
import {
  allSchemas,
  reviveSoundNotifierSettingsEnvelope,
  reviveWorkflowParamPresetsEnvelope,
  reviveWorkflowsEnvelope,
} from "./schemas"
import type { NamespaceSchema } from "./types"

export interface FileBackedDataRepositoryOptions {
  readonly rootDir: string
  readonly safeStorage: SafeStorage
}

type RecordValue = Record<string, unknown>
type IdentifiedRecordValue = RecordValue & { id: string }

export function createFileBackedDataRepository(
  options: FileBackedDataRepositoryOptions,
): DataRepositoryImpl {
  mkdirSync(options.rootDir, { recursive: true })

  const repo = new DataRepositoryImpl()
  let sqliteDb: ReturnType<typeof openSqliteDatabase> | null = null

  for (const schema of allSchemas) {
    const recordSchema = schema as NamespaceSchema<RecordValue>
    switch (schema.backend) {
      case "json":
        repo.register(recordSchema, new JsonNamespace({
          name: schema.name,
          schemaVersion: schema.currentVersion,
          backend: "json",
          filePath: path.join(options.rootDir, `${safeFileName(schema.name)}.json`),
          defaults: recordSchema.defaults,
          validate: recordSchema.validate,
          reviveEnvelope: jsonReviveEnvelopeFor(schema.name),
          preserveInvalidJson: schema.name === "workflows",
        }))
        break
      case "encrypted-json":
        repo.register(recordSchema, new EncryptedJsonNamespace({
          name: schema.name,
          schemaVersion: schema.currentVersion,
          backend: "encrypted-json",
          filePath: path.join(options.rootDir, `${safeFileName(schema.name)}.bin`),
          legacyPlaintextFilePath: path.join(options.rootDir, `${safeFileName(schema.name)}.json`),
          safeStorage: options.safeStorage,
          defaults: recordSchema.defaults,
          validate: recordSchema.validate,
        }))
        break
      case "jsonl":
        repo.register(schema as NamespaceSchema<IdentifiedRecordValue>, new JsonLinesNamespace({
          name: schema.name,
          schemaVersion: schema.currentVersion,
          backend: "jsonl",
          filePath: path.join(options.rootDir, `${safeFileName(schema.name)}.jsonl`),
          defaults: (schema as NamespaceSchema<IdentifiedRecordValue>).defaults,
          validate: (schema as NamespaceSchema<IdentifiedRecordValue>).validate,
        }))
        break
      case "sqlite": {
        sqliteDb ??= openSqliteDatabase(path.join(options.rootDir, "runtime.sqlite"))
        const identifiedSchema = schema as NamespaceSchema<IdentifiedRecordValue>
        repo.register(identifiedSchema, new SqliteNamespace({
          name: schema.name,
          schemaVersion: schema.currentVersion,
          backend: "sqlite",
          database: sqliteDb,
          indexes: sqliteIndexesFor(schema.name),
          defaults: identifiedSchema.defaults,
          validate: identifiedSchema.validate,
        }))
        break
      }
      default: {
        const exhaustive: never = schema.backend
        throw new Error(`Unsupported DataRepository backend: ${exhaustive}`)
      }
    }
  }

  return repo
}

export function sqliteIndexesFor(namespace: string): readonly string[] {
  switch (namespace) {
    case "conversations":
      return [
        "json_extract(value, '$.projectId')",
        "json_extract(value, '$.projectId'), json_extract(value, '$.sessionKey'), json_extract(value, '$.workspaceKey'), json_extract(value, '$.active'), id",
      ]
    case "outbox":
      return [
        "json_extract(value, '$.projectId')",
        "json_extract(value, '$.projectId'), json_extract(value, '$.status'), id",
      ]
    case "repo.pending-pushes":
    case "webhook.runs":
    case "relay.runs":
      return ["json_extract(value, '$.projectId')"]
    case "agent.usage":
      return [
        "json_extract(value, '$.projectId'), json_extract(value, '$.conversationId')",
        "json_extract(value, '$.projectId'), json_extract(value, '$.conversationId'), id",
        "json_extract(value, '$.projectId'), json_extract(value, '$.workflowRunId'), id",
        "json_extract(value, '$.projectId'), json_extract(value, '$.taskRunId'), id",
      ]
    case "agent.events":
      return [
        "json_extract(value, '$.projectId'), json_extract(value, '$.conversationId')",
        "json_extract(value, '$.projectId'), json_extract(value, '$.conversationId'), id",
        "json_extract(value, '$.conversationId'), id",
      ]
    case "agent.artifacts":
      return [
        "json_extract(value, '$.projectId'), json_extract(value, '$.conversationId')",
        "json_extract(value, '$.projectId'), json_extract(value, '$.conversationId'), id",
        "json_extract(value, '$.conversationId'), json_extract(value, '$.turnId'), id",
      ]
    case "app.quick-input.items":
      return ["json_extract(value, '$.sortOrder'), id"]
    case "app.agent-personas.items":
      return ["json_extract(value, '$.createdAt'), id"]
    case "app.swarm-task.worker-runs":
      return [
        "json_extract(value, '$.runId'), json_extract(value, '$.roundIndex'), json_extract(value, '$.workerIndex'), id",
      ]
    default:
      return []
  }
}

function safeFileName(namespace: string): string {
  return namespace.replace(/[^a-zA-Z0-9_.-]/g, "_")
}

function jsonReviveEnvelopeFor(namespace: string) {
  if (namespace === "workflows") return reviveWorkflowsEnvelope
  if (namespace === "workflow.param-presets") return reviveWorkflowParamPresetsEnvelope
  if (namespace === "app.sound-notifier.settings") return reviveSoundNotifierSettingsEnvelope
  return undefined
}
