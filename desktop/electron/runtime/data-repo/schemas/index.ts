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
  repoPendingPushesSchema,
  type RepoPendingPushV1,
} from "./repo-pending-pushes"
export {
  repoRepositoriesSchema,
  type RepoRepositoryV1,
} from "./repo-repositories"
export {
  auditSchema,
  agentCommandSettingsSchema,
  agentCommandsSchema,
  connectorsSchema,
  conversationsSchema,
  outboxSchema,
  projectsSchema,
  providersSchema,
  scheduledHeartbeatSchema,
  scheduledJobsSchema,
  secretsSchema,
  workspaceBindingsSchema,
  type AuditEntryV1,
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
  type HeartbeatEntryV1,
  type OutboxEntryV1,
  type OutboxPayloadV1,
  type ProjectEntryV1,
  type ProviderCodexOptionsV1,
  type ProviderEntryV1,
  type ProviderModelEntryV1,
  type ProviderOptionsV1,
  type ScheduledJobEntryV1,
  type ScheduledJobKindV1,
  type ScheduledJobPlatformV1,
  type ScheduledJobSessionModeV1,
  type ScheduledJobStatusV1,
  type SecretEntryV1,
  type WorkspaceBindingEntryV1,
} from "./placeholders"

import { coreConfigSchema } from "./core-config"
import { coreIdentitySchema } from "./core-identity"
import { repoPendingPushesSchema } from "./repo-pending-pushes"
import { repoRepositoriesSchema } from "./repo-repositories"
import {
  auditSchema,
  agentCommandSettingsSchema,
  agentCommandsSchema,
  connectorsSchema,
  conversationsSchema,
  outboxSchema,
  projectsSchema,
  providersSchema,
  scheduledHeartbeatSchema,
  scheduledJobsSchema,
  secretsSchema,
  workspaceBindingsSchema,
} from "./placeholders"
import type { NamespaceSchema } from "../types"

/** Stable iteration order: framework reads/writes namespaces in this order. */
export const allSchemas: readonly NamespaceSchema<unknown>[] = [
  coreConfigSchema,
  coreIdentitySchema,
  repoRepositoriesSchema,
  repoPendingPushesSchema,
  secretsSchema,
  providersSchema,
  projectsSchema,
  workspaceBindingsSchema,
  agentCommandsSchema,
  agentCommandSettingsSchema,
  scheduledJobsSchema,
  scheduledHeartbeatSchema,
  connectorsSchema,
  conversationsSchema,
  auditSchema,
  outboxSchema,
] as ReadonlyArray<NamespaceSchema<unknown>>
