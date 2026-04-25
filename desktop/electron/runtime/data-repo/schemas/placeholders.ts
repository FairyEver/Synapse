/**
 * Phase 0.2 — Schema placeholders for namespaces that don't have data yet.
 *
 * SPEC §5 namespace strategy table. These schemas exist so:
 *   1. DataRepository.inspect() lists them once they're registered.
 *   2. M1 (Provider/Agent) consumers can register migrations starting from v1
 *      without conflicting with the framework.
 *   3. Backup/exporter can iterate over them by name.
 *
 * Each schema is a v1 placeholder with no data shape constraints. M1+ replaces
 * each with a real type definition + migrations.
 */

import type { Migration, NamespaceSchema } from "../types"

const isAnyRecord = <T extends Record<string, unknown>>(value: unknown): value is T => {
  return typeof value === "object" && value !== null
}

const noMigrations: readonly Migration[] = []

export interface SecretEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  /** Cipher-resolved value lives in EncryptedJsonBackend storage; this struct is the wrapper metadata. */
  kind: "api-key" | "oauth-token" | "webhook-secret" | "generic"
  description?: string
}

export const secretsSchema: NamespaceSchema<SecretEntryV1> = {
  name: "secrets",
  backend: "encrypted-json",
  currentVersion: 1,
  migrations: noMigrations,
  encrypted: true,
  validate: (v): v is SecretEntryV1 =>
    isAnyRecord<SecretEntryV1>(v)
    && (v as SecretEntryV1).schemaVersion === 1
    && typeof (v as SecretEntryV1).id === "string"
    && typeof (v as SecretEntryV1).kind === "string",
}

export interface ProviderEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  kind: string
  /** Foreign key to a `secrets` namespace entry. */
  secretRef?: string
  display?: string
}

export const providersSchema: NamespaceSchema<ProviderEntryV1> = {
  name: "providers",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is ProviderEntryV1 =>
    isAnyRecord<ProviderEntryV1>(v)
    && (v as ProviderEntryV1).schemaVersion === 1
    && typeof (v as ProviderEntryV1).id === "string"
    && typeof (v as ProviderEntryV1).kind === "string",
}

export interface ProjectEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  name: string
  workspacePath?: string
}

export const projectsSchema: NamespaceSchema<ProjectEntryV1> = {
  name: "projects",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is ProjectEntryV1 =>
    isAnyRecord<ProjectEntryV1>(v)
    && (v as ProjectEntryV1).schemaVersion === 1
    && typeof (v as ProjectEntryV1).id === "string"
    && typeof (v as ProjectEntryV1).name === "string",
}

export interface ConnectorEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  platform: string
  secretRef?: string
}

export const connectorsSchema: NamespaceSchema<ConnectorEntryV1> = {
  name: "connectors",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is ConnectorEntryV1 =>
    isAnyRecord<ConnectorEntryV1>(v)
    && (v as ConnectorEntryV1).schemaVersion === 1
    && typeof (v as ConnectorEntryV1).id === "string"
    && typeof (v as ConnectorEntryV1).platform === "string",
}

export interface ConversationEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  projectId: string
  startedAt: string
  endedAt?: string
}

export const conversationsSchema: NamespaceSchema<ConversationEntryV1> = {
  name: "conversations",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is ConversationEntryV1 =>
    isAnyRecord<ConversationEntryV1>(v)
    && (v as ConversationEntryV1).schemaVersion === 1
    && typeof (v as ConversationEntryV1).id === "string"
    && typeof (v as ConversationEntryV1).projectId === "string",
}

export interface AuditEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  action: string
  actor: string
  resource: string
  outcome: "allowed" | "denied" | "failed"
  timestamp: string
}

export const auditSchema: NamespaceSchema<AuditEntryV1> = {
  name: "audit",
  backend: "jsonl",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is AuditEntryV1 =>
    isAnyRecord<AuditEntryV1>(v)
    && (v as AuditEntryV1).schemaVersion === 1
    && typeof (v as AuditEntryV1).action === "string"
    && typeof (v as AuditEntryV1).outcome === "string",
}

export interface OutboxEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  destination: string
  payload: unknown
  attempts: number
}

export const outboxSchema: NamespaceSchema<OutboxEntryV1> = {
  name: "outbox",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is OutboxEntryV1 =>
    isAnyRecord<OutboxEntryV1>(v)
    && (v as OutboxEntryV1).schemaVersion === 1
    && typeof (v as OutboxEntryV1).destination === "string"
    && typeof (v as OutboxEntryV1).attempts === "number",
}
