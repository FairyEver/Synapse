/**
 * Phase 0.2 — Schema barrel.
 *
 * Re-exports each NamespaceSchema so callers can register them in one go via
 * DataRepository.registerSchemas(). Each schema also exports a typed validator
 * that backends can pass to `JsonNamespace({ validate })` etc.
 */

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
  coreLicenseSchema,
  type CoreLicenseV1,
} from "./core-license"
export {
  repoPendingPushesSchema,
  type RepoPendingPushV1,
} from "./repo-pending-pushes"
export {
  repoRepositoriesSchema,
  type RepoRepositoryV1,
} from "./repo-repositories"
export {
  auditSchema,
  agentCompressStateSchema,
  agentCommandSettingsSchema,
  agentCommandsSchema,
  connectorsSchema,
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
  taskSchedulerRunsSchema,
  taskSchedulerTasksSchema,
  webhookConfigSchema,
  webhookRunsSchema,
  workspaceBindingsSchema,
  type AuditEntryV1,
  type AgentCompressStateEntryV1,
  type AgentCompressStatusV1,
  type AgentCommandEntryV1,
  type AgentCommandKindV1,
  type AgentCommandSettingsEntryV1,
  type AgentCommandSourceV1,
  type ConnectorAllowlistV1,
  type ConnectorDedupeStateV1,
  type ConnectorEntryV1,
  type ConnectorReconnectStateV1,
  type ConnectorSessionKeyPolicyV1,
  type ConnectorStatusV1,
  type ConnectorWorkspaceConfigV1,
  type ConversationEntryV1,
  type ConversationResumePolicyV1,
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
  type WorkspaceBindingEntryV1,
} from "./placeholders"

import { coreConfigSchema } from "./core-config"
import { coreIdentitySchema } from "./core-identity"
import { coreLicenseSchema } from "./core-license"
import { repoPendingPushesSchema } from "./repo-pending-pushes"
import { repoRepositoriesSchema } from "./repo-repositories"
import {
  auditSchema,
  agentCompressStateSchema,
  agentCommandSettingsSchema,
  agentCommandsSchema,
  connectorsSchema,
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
  taskSchedulerRunsSchema,
  taskSchedulerTasksSchema,
  webhookConfigSchema,
  webhookRunsSchema,
  workspaceBindingsSchema,
} from "./placeholders"
import type { NamespaceSchema } from "../types"

/** Stable iteration order: framework reads/writes namespaces in this order. */
export const allSchemas: readonly NamespaceSchema<unknown>[] = [
  coreConfigSchema,
  coreIdentitySchema,
  coreLicenseSchema,
  repoRepositoriesSchema,
  repoPendingPushesSchema,
  secretsSchema,
  providersSchema,
  projectsSchema,
  workspaceBindingsSchema,
  agentCommandsSchema,
  agentCommandSettingsSchema,
  agentCompressStateSchema,
  taskSchedulerTasksSchema,
  taskSchedulerRunsSchema,
  runAsConfigSchema,
  runAsPreflightSchema,
  webhookConfigSchema,
  webhookRunsSchema,
  relayBindingsSchema,
  relayRunsSchema,
  opsDiagnosticsSchema,
  connectorsSchema,
  conversationsSchema,
  auditSchema,
  outboxSchema,
] as ReadonlyArray<NamespaceSchema<unknown>>
