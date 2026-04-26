import path from "node:path"
import { mkdirSync } from "node:fs"

import { EncryptedJsonNamespace, type SafeStorage } from "./backends/encrypted-json"
import { JsonNamespace } from "./backends/json"
import { JsonLinesNamespace } from "./backends/jsonl"
import { openSqliteDatabase, SqliteNamespace } from "./backends/sqlite"
import { DataRepositoryImpl } from "./repository"
import { allSchemas } from "./schemas"
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
        }))
        break
      case "encrypted-json":
        repo.register(recordSchema, new EncryptedJsonNamespace({
          name: schema.name,
          schemaVersion: schema.currentVersion,
          backend: "encrypted-json",
          filePath: path.join(options.rootDir, `${safeFileName(schema.name)}.bin`),
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

function sqliteIndexesFor(namespace: string): readonly string[] {
  switch (namespace) {
    case "conversations":
    case "outbox":
    case "repo.pending-pushes":
      return ["json_extract(value, '$.projectId')"]
    default:
      return []
  }
}

function safeFileName(namespace: string): string {
  return namespace.replace(/[^a-zA-Z0-9_.-]/g, "_")
}
