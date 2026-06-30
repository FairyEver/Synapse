/**
 * Phase 0.2 — Schema barrel.
 *
 * Re-exports each NamespaceSchema so callers can register them in one go via
 * DataRepository.registerSchemas(). Each schema also exports a typed validator
 * that backends can pass to `JsonNamespace({ validate })` etc.
 */

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
  agentPersonaItemsSchema,
  type AgentPersonaItemEntryV1,
  type AgentPersonaProviderModelEntryV1,
} from "./agent-personas"
export {
  reviveSoundNotifierSettingsEnvelope,
  soundNotifierSettingsSchemaDefinition,
  type SoundNotifierSettingsEntryV1,
  type SoundNotifierSettingsEntryV2,
  type SoundNotifierSettingsEntryV3,
} from "./sound-notifier"
export {
  auditSchema,
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
  normalizeWorkflowEntry,
  reviveWorkflowsEnvelope,
  workflowParamPresetsSchema,
  workflowsSchema,
  type AuditEntryV1,
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
  type ConversationResumePolicyV1,
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
  type WorkflowEntryV1,
} from "./placeholders"

import { coreConfigSchema } from "./core-config"
import { cheatCodeStatesSchema } from "./cheat-code-states"
import { coreIdentitySchema } from "./core-identity"
import { driveSyncBaselineSchema, driveSyncBindingsSchema, driveSyncConflictsSchema, driveSyncOperationsSchema, driveSyncStateSchema } from "./drive-sync"
import { repoPendingPushesSchema } from "./repo-pending-pushes"
import { repoRepositoriesSchema } from "./repo-repositories"
import { quickInputItemsSchema, quickInputSettingsSchema } from "./quick-input"
import { agentPersonaItemsSchema } from "./agent-personas"
import { soundNotifierSettingsSchemaDefinition } from "./sound-notifier"
import {
  auditSchema,
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
  normalizeWorkflowEntry,
  reviveWorkflowsEnvelope,
  workflowParamPresetsSchema,
  workflowsSchema,
} from "./placeholders"
import type { NamespaceSchema } from "../types"

/** Stable iteration order: framework reads/writes namespaces in this order. */
export const allSchemas: readonly NamespaceSchema<unknown>[] = [
  coreConfigSchema,
  coreIdentitySchema,
  driveSyncBindingsSchema,
  driveSyncBaselineSchema,
  driveSyncOperationsSchema,
  driveSyncConflictsSchema,
  driveSyncStateSchema,
  repoRepositoriesSchema,
  repoPendingPushesSchema,
  cheatCodeStatesSchema,
  quickInputItemsSchema,
  quickInputSettingsSchema,
  agentPersonaItemsSchema,
  soundNotifierSettingsSchemaDefinition,
  secretsSchema,
  providersSchema,
  projectsSchema,
  agentCommandsSchema,
  agentCommandSettingsSchema,
  agentCompressStateSchema,
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
  workflowsSchema,
  conversationsSchema,
  auditSchema,
  outboxSchema,
] as ReadonlyArray<NamespaceSchema<unknown>>
