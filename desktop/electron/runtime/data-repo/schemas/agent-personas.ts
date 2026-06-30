import type { Migration, NamespaceSchema } from "../types"
import { AGENT_PERSONAS_ITEMS_NAMESPACE } from "../../../../app-capabilities/agent-personas/shared/capability"
import type { AgentPersonaModelTier } from "../../../../app-capabilities/agent-personas/shared/schema"

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
  source: "user"
  createdAt: string
  updatedAt: string
}

const noMigrations: readonly Migration[] = []
const modelTiers = new Set(["default", "haiku", "sonnet", "opus"])

export const agentPersonaItemsSchema: NamespaceSchema<AgentPersonaItemEntryV1> = {
  name: AGENT_PERSONAS_ITEMS_NAMESPACE,
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: isAgentPersonaItemEntryV1,
  encrypted: false,
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
    && value.source === "user"
    && isIsoDateString(value.createdAt)
    && isIsoDateString(value.updatedAt)
}

function isNullableProviderModel(value: unknown): value is AgentPersonaProviderModelEntryV1 | null {
  if (value === null) return true
  if (!isRecord(value)) return false
  return typeof value.providerId === "string"
    && value.providerId.trim().length > 0
    && typeof value.modelTier === "string"
    && modelTiers.has(value.modelTier)
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && !Number.isNaN(Date.parse(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
