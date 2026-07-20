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
  agentArtifactsSchema,
  agentCompressStateSchema,
  agentCommandSettingsSchema,
  agentCommandsSchema,
  agentEventsSchema,
  agentUsageSchema,
  agentPersonaItemsSchema,
  agentPersonaRemoteCacheSchema,
  agentPersonaSettingsSchema,
  automationItemsSchema,
  automationRunsSchema,
  conversationsSchema,
  coreConfigSchema,
  coreIdentitySchema,
  driveSyncBaselineSchema,
  driveSyncBindingsSchema,
  driveSyncConflictsSchema,
  driveSyncOperationsSchema,
  driveSyncStateSchema,
  isLegacyCoreConfigV0,
  outboxSchema,
  opsDiagnosticsSchema,
  projectsSchema,
  providersSchema,
  quickInputItemsSchema,
  quickInputSettingsSchema,
  reviveSoundNotifierSettingsEnvelope,
  soundNotifierSettingsSchemaDefinition,
  relayBindingsSchema,
  relayRunsSchema,
  runAsConfigSchema,
  runAsPreflightSchema,
  repoPendingPushesSchema,
  repoRepositoriesSchema,
  secretsItemsSchema,
  secretsSchema,
  secretsSettingsSchema,
  webhookConfigSchema,
  webhookRunsSchema,
  reviveWorkflowsEnvelope,
  workflowParamPresetsSchema,
  workflowMigrationStateSchema,
  workflowShareStateSchema,
  workflowsSchema,
  type AuditEntryV1,
  type AgentArtifactEntryV1,
  type AgentCompressStateEntryV1,
  type AgentCompressStatusV1,
  type AgentCommandEntryV1,
  type AgentCommandKindV1,
  type AgentCommandSettingsEntryV1,
  type AgentCommandSourceV1,
  type AgentEventEntryV1,
  type AgentUsageEntryV1,
  type AgentUsageSummaryV1,
  type AgentPersonaItemEntryV1,
  type AgentPersonaProviderModelEntryV1,
  type AgentPersonaRemoteCacheEntryV1,
  type AgentPersonaRemoteCacheUserBucketV1,
  type AgentPersonaSettingsEntryV1,
  type AutomationActiveRunStatusV1,
  type AutomationItemEntryV1,
  type AutomationRefV1,
  type AutomationRunEntryV1,
  type AutomationRunStatusV1,
  type AutomationRunTriggerV1,
  type AutomationScopeV1,
  type ConversationEntryV1,
  type ConversationMainThreadPersonaSnapshotV1,
  type ConversationResumePolicyV1,
  type ConversationTitleSourceV1,
  type ConversationUsageV1,
  type CoreConfigV1,
  type CoreIdentityV2,
  type DriveSyncBaselineEntryV1,
  type DriveSyncBindingEntryV1,
  type DriveSyncConflictEntryV1,
  type DriveSyncOperationEntryV1,
  type DriveSyncStateEntryV1,
  type OpsDiagnosticsEntryV1,
  type OutboxEntryV1,
  type OutboxPayloadV1,
  type ProjectEntryV1,
  type ProviderCodexOptionsV1,
  type ProviderEntryV1,
  type ProviderModelEntryV1,
  type ProviderOptionsV1,
  type QuickInputItemEntryV1,
  type QuickInputSettingsEntryV1,
  type SoundNotifierSettingsEntryV1,
  type SoundNotifierSettingsEntryV2,
  type SoundNotifierSettingsEntryV3,
  type RelayBindingEntryV1,
  type RelayRunEntryV1,
  type RelayRunStatusV1,
  type RepoPendingPushV1,
  type RepoRepositoryV1,
  type RunAsCheckStatusV1,
  type RunAsConfigEntryV1,
  type RunAsPreflightEntryV1,
  type SecretEntryV1,
  type SecretItemEntryV1,
  type SecretSettingsEntryV1,
  type WebhookConfigEntryV1,
  type WebhookRunEntryV1,
  type WebhookRunStatusV1,
  type WorkflowParamPresetEntryV1,
  type WorkflowParamPresetEntryV2,
  type WorkflowParamPresetValueV2,
  type WorkflowMigrationStateEntryV1,
  type WorkflowMigrationStateStatus,
  type WorkflowShareOriginEntryV1,
  type WorkflowShareExportEntryV1,
  type WorkflowShareStateEntryV1,
  type WorkflowShareTransactionEntryV1,
  type WorkflowShareUndoEntryV1,
  reviveWorkflowParamPresetsEnvelope,
  type WorkflowEntryV1,
} from "./schemas"
export {
  AtomicSourceChangedError,
  copyToTimestampedBackup,
  fileExists,
  readBinaryFile,
  readJsonFile,
  readTextFile,
  writeBinaryFileAtomic,
  writeJsonFileAtomic,
  writeJsonFileAtomicIfUnchanged,
  writeTextFileAtomic,
} from "./atomic-io"
