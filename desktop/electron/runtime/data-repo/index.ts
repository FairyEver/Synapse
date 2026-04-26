/**
 * Phase 0.2 — DataRepository module entrypoint.
 *
 * Implementation lands incrementally:
 *   T2.1 (this commit): types + errors + DataNamespace abstract base.
 *   T2.2..T2.5: backends (json / encrypted-json / jsonl / sqlite).
 *   T2.6: migration framework.
 *   T2.7..T2.9: namespace migrations + secrets/providers schema placeholders.
 *   T2.10..T2.12: backup / exporter / layered-config.
 *   T2.13: rewire config-backup-service.
 *   T2.14: phase integration test.
 */

export * from "./types"
export * from "./errors"
export { AbstractDataNamespace } from "./namespace-base"
export type { NamespaceBaseDeps } from "./namespace-base"
export { JsonNamespace } from "./backends/json"
export type { JsonBackendDeps, JsonFileEnvelope } from "./backends/json"
export { EncryptedJsonNamespace } from "./backends/encrypted-json"
export type { EncryptedJsonBackendDeps, SafeStorage } from "./backends/encrypted-json"
export { JsonLinesNamespace } from "./backends/jsonl"
export type { JsonLinesBackendDeps } from "./backends/jsonl"
export { SqliteNamespace, openSqliteDatabase } from "./backends/sqlite"
export type { SqliteBackendDeps } from "./backends/sqlite"
export { runMigrations, migration } from "./migrations"
export type { RunMigrationsArgs } from "./migrations"
export {
  InMemoryBackupRegistry,
  LocalArchiveStrategy,
} from "./backup"
export type { LocalArchiveStrategyDeps } from "./backup"

export {
  InMemoryExporterRegistry,
  csvExporterFor,
  jsonExporterFor,
} from "./exporters"

export { InMemoryLayeredConfig } from "./layered-config"

export { DataRepositoryImpl, createDataRepository } from "./repository"
export { createFileBackedDataRepository } from "./factory"
export type { FileBackedDataRepositoryOptions } from "./factory"

export {
  allSchemas,
  auditSchema,
  connectorsSchema,
  conversationsSchema,
  coreConfigSchema,
  coreIdentitySchema,
  isLegacyCoreConfigV0,
  outboxSchema,
  projectsSchema,
  providersSchema,
  repoPendingPushesSchema,
  repoRepositoriesSchema,
  secretsSchema,
  type AuditEntryV1,
  type ConnectorEntryV1,
  type ConversationEntryV1,
  type ConversationResumePolicyV1,
  type CoreConfigV1,
  type CoreIdentityV2,
  type OutboxEntryV1,
  type ProjectEntryV1,
  type ProviderCodexOptionsV1,
  type ProviderEntryV1,
  type ProviderModelEntryV1,
  type ProviderOptionsV1,
  type RepoPendingPushV1,
  type RepoRepositoryV1,
  type SecretEntryV1,
} from "./schemas"
export {
  copyToTimestampedBackup,
  fileExists,
  readBinaryFile,
  readJsonFile,
  readTextFile,
  writeBinaryFileAtomic,
  writeJsonFileAtomic,
  writeTextFileAtomic,
} from "./atomic-io"
