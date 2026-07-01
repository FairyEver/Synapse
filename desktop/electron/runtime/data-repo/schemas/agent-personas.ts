import type { Migration, NamespaceSchema } from "../types"
import {
  AGENT_PERSONAS_ITEMS_NAMESPACE,
  AGENT_PERSONAS_SETTINGS_NAMESPACE,
} from "../../../../app-capabilities/agent-personas/shared/capability"
import type {
  AgentPersonaModelTier,
  AgentPersonaToolPolicyMode,
} from "../../../../app-capabilities/agent-personas/shared/schema"

export interface AgentPersonaProviderModelEntryV1 extends Record<string, unknown> {
  providerId: string
  modelTier: AgentPersonaModelTier
}

export interface AgentPersonaItemEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  name: string
  description: string
  systemPrompt: string
  providerModel: AgentPersonaProviderModelEntryV1 | null
  toolPolicy?: AgentPersonaToolPolicyEntryV1
  source: "user"
  createdAt: string
  updatedAt: string
}

export interface AgentPersonaToolPolicyEntryV1 extends Record<string, unknown> {
  mode: AgentPersonaToolPolicyMode
  allowedTools?: string[]
}

export interface AgentPersonaSettingsEntryV1 extends Record<string, unknown> {
  schemaVersion: 1
  builtinProviderModels: Record<string, AgentPersonaProviderModelEntryV1 | null>
}

const noMigrations: readonly Migration[] = []
const modelTiers = new Set(["default", "haiku", "sonnet", "opus"])
const toolPolicyModes = new Set(["all", "allowlist", "disabled"])

export const agentPersonaItemsSchema: NamespaceSchema<AgentPersonaItemEntryV1> = {
  name: AGENT_PERSONAS_ITEMS_NAMESPACE,
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: isAgentPersonaItemEntryV1,
  encrypted: false,
}

export const agentPersonaSettingsSchema: NamespaceSchema<AgentPersonaSettingsEntryV1> = {
  name: AGENT_PERSONAS_SETTINGS_NAMESPACE,
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: isAgentPersonaSettingsEntryV1,
  encrypted: false,
  defaults: () => ({
    schemaVersion: 1,
    builtinProviderModels: {},
  }),
}

function isAgentPersonaItemEntryV1(value: unknown): value is AgentPersonaItemEntryV1 {
  if (!isRecord(value)) return false
  return value.schemaVersion === 1
    && typeof value.id === "string"
    && value.id.trim().length > 0
    && typeof value.name === "string"
    && value.name.trim().length > 0
    && typeof value.description === "string"
    && value.description.trim().length > 0
    && typeof value.systemPrompt === "string"
    && value.systemPrompt.trim().length > 0
    && isNullableProviderModel(value.providerModel)
    && isOptionalToolPolicy(value.toolPolicy)
    && value.source === "user"
    && isIsoDateString(value.createdAt)
    && isIsoDateString(value.updatedAt)
}

function isAgentPersonaSettingsEntryV1(value: unknown): value is AgentPersonaSettingsEntryV1 {
  if (!isRecord(value)) return false
  if (value.schemaVersion !== 1) return false
  if (!isRecord(value.builtinProviderModels)) return false

  return Object.values(value.builtinProviderModels)
    .every((entry) => entry === null || isNullableProviderModel(entry))
}

function isNullableProviderModel(value: unknown): value is AgentPersonaProviderModelEntryV1 | null {
  if (value === null) return true
  if (!isRecord(value)) return false
  return typeof value.providerId === "string"
    && value.providerId.trim().length > 0
    && typeof value.modelTier === "string"
    && modelTiers.has(value.modelTier)
}

function isOptionalToolPolicy(value: unknown): value is AgentPersonaToolPolicyEntryV1 | undefined {
  if (value === undefined) return true
  if (!isRecord(value)) return false
  return typeof value.mode === "string"
    && toolPolicyModes.has(value.mode)
    && (value.allowedTools === undefined
      || (Array.isArray(value.allowedTools)
        && value.allowedTools.every((tool) => typeof tool === "string" && tool.trim().length > 0)))
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && !Number.isNaN(Date.parse(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
