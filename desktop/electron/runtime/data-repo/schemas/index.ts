/**
 * Phase 0.2 — Schema barrel.
 *
 * Re-exports each NamespaceSchema so callers can register them in one go via
 * DataRepository.registerSchemas(). Each schema also exports a typed validator
 * that backends can pass to `JsonNamespace({ validate })` etc.
 */

export {
  clientTelemetryOutboxSchema,
  type ClientTelemetryCategory,
  type ClientTelemetryOutcome,
  type ClientTelemetryOutboxEntryV1,
} from "./client-telemetry"
export {
  cheatCodeStatesSchema,
  type CheatCodeStatesEntryV1,
} from "./cheat-code-states"
export {
  coreConfigSchema,
  isLegacyCoreConfigV0,
  type CoreConfigV1,
} from "./core-config"
export {
  workflowMigrationStateSchema,
  type WorkflowMigrationStateEntryV1,
  type WorkflowMigrationStateStatus,
} from "./workflow-migration-state"
export {
  workflowShareStateSchema,
  type WorkflowShareExportEntryV1,
  type WorkflowShareOriginEntryV1,
  type WorkflowShareStateEntryV1,
  type WorkflowShareTransactionEntryV1,
  type WorkflowShareUndoEntryV1,
} from "./workflow-share-state"
export {
  coreIdentitySchema,
  type CoreIdentityV2,
} from "./core-identity"
export {
  driveSyncBaselineSchema,
  driveSyncBindingsSchema,
  driveSyncConflictsSchema,
  driveSyncOperationsSchema,
  driveSyncStateSchema,
  type DriveSyncBaselineEntryV1,
  type DriveSyncBindingEntryV1,
  type DriveSyncConflictEntryV1,
  type DriveSyncOperationEntryV1,
  type DriveSyncStateEntryV1,
} from "./drive-sync"
export {
  gitCloneJournalSchema,
  type GitCloneJournalEntryV1,
} from "./git-clone-journal"
export {
  repoPendingPushesSchema,
  type RepoPendingPushV1,
} from "./repo-pending-pushes"
export {
  repoRepositoriesSchema,
  type RepoRepositoryV1,
} from "./repo-repositories"
export {
  quickInputItemsSchema,
  quickInputSettingsSchema,
  type QuickInputItemEntryV1,
  type QuickInputSettingsEntryV1,
} from "./quick-input"
export {
  connectorsItemsSchema,
  connectorsCredentialsSchema,
  connectorsStateSchema,
  type ConnectorItemEntryV1,
  type ConnectorCredentialEntryV1,
  type ConnectorLocalStateV1,
  type ConnectorProbeErrorCodeV1,
  type ConnectorStateStoreV1,
} from "./connectors"
export {
  secretsItemsSchema,
  secretsSettingsSchema,
  type SecretItemEntryV1,
  type SecretSettingsEntryV1,
} from "./secrets"
export {
  agentPersonaItemsSchema,
  agentPersonaSettingsSchema,
  type AgentPersonaItemEntryV1,
  type AgentPersonaProviderModelEntryV1,
  type AgentPersonaSettingsEntryV1,
} from "./agent-personas"
export {
  agentPersonaRemoteCacheSchema,
  type AgentPersonaRemoteCacheEntryV1,
  type AgentPersonaRemoteCacheUserBucketV1,
} from "./agent-persona-remote-cache"
export {
  agentFileCheckpointsSchema,
  type AgentFileCheckpointChangeKindV1,
  type AgentFileCheckpointEntryV1,
  type AgentFileCheckpointFileV1,
  type AgentFileCheckpointFingerprintV1,
  type AgentFileCheckpointStatusV1,
} from "./agent-file-checkpoints"
export {
  reviveSoundNotifierSettingsEnvelope,
  soundNotifierSettingsSchemaDefinition,
  type SoundNotifierSettingsEntryV1,
  type SoundNotifierSettingsEntryV2,
  type SoundNotifierSettingsEntryV3,
} from "./sound-notifier"
export {
  systemNotifierSettingsSchemaDefinition,
  type SystemNotifierSettingsEntryV1,
} from "./system-notifier"
export {
  updateInstallRecoverySchema,
  type PendingUpdateInstallAttemptV1,
  type UpdateInstallRecoveryEntryV1,
  type UpdateInstallRecoveryPhase,
} from "./update-install-recovery"
export {
  terminalAgentNotificationSettingsSchemaDefinition,
  terminalBlocksSchema,
  terminalCommandBodiesSchema,
  terminalCommandsSchema,
  terminalDeleteIntentsSchema,
  terminalDomainStateSchemaDefinition,
  terminalGlobalLaunchBodiesSchema,
  terminalGlobalLaunchSchema,
  terminalGroupsSchema,
  terminalGroupLaunchBodiesSchema,
  terminalIdempotencySchema,
  terminalLaunchBodiesSchema,
  terminalOperationsSchema,
  terminalSessionsSchema,
  terminalToolbarActionsSchema,
  terminalWorkspacesSchema,
  type TerminalBlockManifestEntry,
  type TerminalDeleteIntentEntry,
  type TerminalToolbarActionsEntry,
} from "./terminal"
export {
  auditSchema,
  agentArtifactsSchema,
  agentCompressStateSchema,
  agentCommandSettingsSchema,
  agentCommandsSchema,
  agentEventsSchema,
  agentUsageSchema,
  automationItemsSchema,
  automationRunsSchema,
  conversationsSchema,
  opsDiagnosticsSchema,
  outboxSchema,
  projectsSchema,
  providersSchema,
  relayBindingsSchema,
  relayRunsSchema,
  runAsConfigSchema,
  runAsPreflightSchema,
  secretsSchema,
  webhookConfigSchema,
  webhookRunsSchema,
  reviveWorkflowsEnvelope,
  workflowParamPresetsSchema,
  workflowsSchema,
  type AuditEntryV1,
  type AgentArtifactEntry,
  type AgentArtifactEntryV1,
  type AgentArtifactEntryV2,
  type AgentCompressStateEntryV1,
  type AgentCompressStatusV1,
  type AgentCommandEntryV1,
  type AgentCommandKindV1,
  type AgentCommandSettingsEntryV1,
  type AgentCommandSourceV1,
  type AgentEventEntryV1,
  type AgentUsageEntryV1,
  type AgentUsageSummaryV1,
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
  type RunAsCheckStatusV1,
  type RunAsConfigEntryV1,
  type RunAsPreflightEntryV1,
  type SecretEntryV1,
  type WebhookConfigEntryV1,
  type WebhookRunEntryV1,
  type WebhookRunStatusV1,
  type WorkflowParamPresetEntryV1,
  type WorkflowParamPresetEntryV2,
  type WorkflowParamPresetValueV2,
  reviveWorkflowParamPresetsEnvelope,
  type WorkflowEntryV1,
} from "./placeholders"

import { coreConfigSchema } from "./core-config"
import { clientTelemetryOutboxSchema } from "./client-telemetry"
import { workflowMigrationStateSchema } from "./workflow-migration-state"
import { workflowShareStateSchema } from "./workflow-share-state"
import { cheatCodeStatesSchema } from "./cheat-code-states"
import { coreIdentitySchema } from "./core-identity"
import { driveSyncBaselineSchema, driveSyncBindingsSchema, driveSyncConflictsSchema, driveSyncOperationsSchema, driveSyncStateSchema } from "./drive-sync"
import { gitCloneJournalSchema } from "./git-clone-journal"
import { repoPendingPushesSchema } from "./repo-pending-pushes"
import { repoRepositoriesSchema } from "./repo-repositories"
import { quickInputItemsSchema, quickInputSettingsSchema } from "./quick-input"
import { connectorsItemsSchema, connectorsCredentialsSchema, connectorsStateSchema } from "./connectors"
import { secretsItemsSchema, secretsSettingsSchema } from "./secrets"
import { agentPersonaItemsSchema, agentPersonaSettingsSchema } from "./agent-personas"
import { agentPersonaRemoteCacheSchema } from "./agent-persona-remote-cache"
import { agentFileCheckpointsSchema } from "./agent-file-checkpoints"
import { soundNotifierSettingsSchemaDefinition } from "./sound-notifier"
import { systemNotifierSettingsSchemaDefinition } from "./system-notifier"
import { updateInstallRecoverySchema } from "./update-install-recovery"
import {
  terminalAgentNotificationSettingsSchemaDefinition,
  terminalBlocksSchema,
  terminalCommandBodiesSchema,
  terminalCommandsSchema,
  terminalDeleteIntentsSchema,
  terminalDomainStateSchemaDefinition,
  terminalGlobalLaunchBodiesSchema,
  terminalGlobalLaunchSchema,
  terminalGroupsSchema,
  terminalGroupLaunchBodiesSchema,
  terminalIdempotencySchema,
  terminalLaunchBodiesSchema,
  terminalOperationsSchema,
  terminalSessionsSchema,
  terminalToolbarActionsSchema,
  terminalWorkspacesSchema,
} from "./terminal"
import {
  auditSchema,
  agentArtifactsSchema,
  agentCompressStateSchema,
  agentCommandSettingsSchema,
  agentCommandsSchema,
  agentEventsSchema,
  agentUsageSchema,
  automationItemsSchema,
  automationRunsSchema,
  conversationsSchema,
  opsDiagnosticsSchema,
  outboxSchema,
  projectsSchema,
  providersSchema,
  relayBindingsSchema,
  relayRunsSchema,
  runAsConfigSchema,
  runAsPreflightSchema,
  secretsSchema,
  webhookConfigSchema,
  webhookRunsSchema,
  workflowParamPresetsSchema,
  workflowsSchema,
} from "./placeholders"
import type { NamespaceSchema } from "../types"

/** Stable iteration order: framework reads/writes namespaces in this order. */
export const allSchemas: readonly NamespaceSchema<unknown>[] = [
  coreConfigSchema,
  clientTelemetryOutboxSchema,
  coreIdentitySchema,
  driveSyncBindingsSchema,
  driveSyncBaselineSchema,
  driveSyncOperationsSchema,
  driveSyncConflictsSchema,
  driveSyncStateSchema,
  gitCloneJournalSchema,
  repoRepositoriesSchema,
  repoPendingPushesSchema,
  cheatCodeStatesSchema,
  quickInputItemsSchema,
  quickInputSettingsSchema,
  connectorsItemsSchema,
  connectorsCredentialsSchema,
  connectorsStateSchema,
  secretsItemsSchema,
  secretsSettingsSchema,
  agentPersonaItemsSchema,
  agentPersonaSettingsSchema,
  agentPersonaRemoteCacheSchema,
  agentFileCheckpointsSchema,
  soundNotifierSettingsSchemaDefinition,
  systemNotifierSettingsSchemaDefinition,
  updateInstallRecoverySchema,
  terminalAgentNotificationSettingsSchemaDefinition,
  terminalGlobalLaunchSchema,
  terminalGlobalLaunchBodiesSchema,
  terminalToolbarActionsSchema,
  terminalGroupsSchema,
  terminalGroupLaunchBodiesSchema,
  terminalCommandsSchema,
  terminalCommandBodiesSchema,
  terminalSessionsSchema,
  terminalWorkspacesSchema,
  terminalOperationsSchema,
  terminalIdempotencySchema,
  terminalLaunchBodiesSchema,
  terminalBlocksSchema,
  terminalDeleteIntentsSchema,
  terminalDomainStateSchemaDefinition,
  secretsSchema,
  providersSchema,
  projectsSchema,
  agentCommandsSchema,
  agentCommandSettingsSchema,
  agentCompressStateSchema,
  agentArtifactsSchema,
  agentEventsSchema,
  agentUsageSchema,
  automationItemsSchema,
  automationRunsSchema,
  runAsConfigSchema,
  runAsPreflightSchema,
  webhookConfigSchema,
  webhookRunsSchema,
  relayBindingsSchema,
  relayRunsSchema,
  opsDiagnosticsSchema,
  workflowParamPresetsSchema,
  workflowMigrationStateSchema,
  workflowShareStateSchema,
  workflowsSchema,
  conversationsSchema,
  auditSchema,
  outboxSchema,
] as ReadonlyArray<NamespaceSchema<unknown>>
