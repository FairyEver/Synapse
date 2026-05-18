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
  agentCompressStateSchema,
  agentCommandSettingsSchema,
  agentCommandsSchema,
  agentEventsSchema,
  connectorsSchema,
  conversationsSchema,
  coreConfigSchema,
  coreIdentitySchema,
  coreLicenseSchema,
  isLegacyCoreConfigV0,
  outboxSchema,
  opsDiagnosticsSchema,
  projectsSchema,
  providersSchema,
  relayBindingsSchema,
  relayRunsSchema,
  runAsConfigSchema,
  runAsPreflightSchema,
  repoPendingPushesSchema,
  repoRepositoriesSchema,
  secretsSchema,
  taskSchedulerRunsSchema,
  taskSchedulerTasksSchema,
  webhookConfigSchema,
  webhookRunsSchema,
  workspaceBindingsSchema,
  workflowsSchema,
  type AuditEntryV1,
  type AgentCompressStateEntryV1,
  type AgentCompressStatusV1,
  type AgentCommandEntryV1,
  type AgentCommandKindV1,
  type AgentCommandSettingsEntryV1,
  type AgentCommandSourceV1,
  type AgentEventEntryV1,
  type ConnectorAllowlistV1,
  type ConnectorDedupeStateV1,
  type ConnectorEntryV1,
  type ConnectorReconnectStateV1,
  type ConnectorSessionKeyPolicyV1,
  type ConnectorStatusV1,
  type ConnectorWorkspaceConfigV1,
  type ConversationEntryV1,
  type ConversationResumePolicyV1,
  type ConversationUsageV1,
  type CoreConfigV1,
  type CoreIdentityV2,
  type CoreLicenseV1,
  type OpsDiagnosticsEntryV1,
  type OutboxEntryV1,
  type OutboxPayloadV1,
  type ProjectEntryV1,
  type ProviderCodexOptionsV1,
  type ProviderEntryV1,
  type ProviderModelEntryV1,
  type ProviderOptionsV1,
  type RelayBindingEntryV1,
  type RelayRunEntryV1,
  type RelayRunStatusV1,
  type RepoPendingPushV1,
  type RepoRepositoryV1,
  type RunAsCheckStatusV1,
  type RunAsConfigEntryV1,
  type RunAsPreflightEntryV1,
  type ScheduledTaskActionV1,
  type ScheduledTaskEntryV1,
  type ScheduledTaskRunEntryV1,
  type ScheduledTaskRunStatusV1,
  type ScheduledTaskRunTriggerV1,
  type ScheduledTaskScopeV1,
  type ScheduledTaskStatusV1,
  type ScheduledTaskTriggerV1,
  type SecretEntryV1,
  type WebhookConfigEntryV1,
  type WebhookRunEntryV1,
  type WebhookRunStatusV1,
  type WorkflowEntryV1,
  type WorkspaceBindingEntryV1,
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
