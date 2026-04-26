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
  connectorsSchema,
  conversationsSchema,
  outboxSchema,
  projectsSchema,
  providersSchema,
  secretsSchema,
  type AuditEntryV1,
  type ConnectorEntryV1,
  type ConversationEntryV1,
  type ConversationResumePolicyV1,
  type OutboxEntryV1,
  type OutboxPayloadV1,
  type ProjectEntryV1,
  type ProviderCodexOptionsV1,
  type ProviderEntryV1,
  type ProviderModelEntryV1,
  type ProviderOptionsV1,
  type SecretEntryV1,
} from "./placeholders"

import { coreConfigSchema } from "./core-config"
import { coreIdentitySchema } from "./core-identity"
import { repoPendingPushesSchema } from "./repo-pending-pushes"
import { repoRepositoriesSchema } from "./repo-repositories"
import {
  auditSchema,
  connectorsSchema,
  conversationsSchema,
  outboxSchema,
  projectsSchema,
  providersSchema,
  secretsSchema,
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
  connectorsSchema,
  conversationsSchema,
  auditSchema,
  outboxSchema,
] as ReadonlyArray<NamespaceSchema<unknown>>
