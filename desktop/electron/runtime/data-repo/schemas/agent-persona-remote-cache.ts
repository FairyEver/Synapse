import { AGENT_PERSONAS_REMOTE_CACHE_NAMESPACE } from "../../../../app-capabilities/agent-personas/shared/capability"
import { agentPersonaSchema, type AgentPersona } from "../../../../app-capabilities/agent-personas/shared/schema"
import type { NamespaceSchema } from "../types"

export interface AgentPersonaRemoteCacheUserBucketV1 extends Record<string, unknown> {
  syncedAt: string
  items: AgentPersona[]
}

export interface AgentPersonaRemoteCacheEntryV1 extends Record<string, unknown> {
  schemaVersion: 1
  users: Record<string, AgentPersonaRemoteCacheUserBucketV1>
}

export const agentPersonaRemoteCacheSchema: NamespaceSchema<AgentPersonaRemoteCacheEntryV1> = {
  name: AGENT_PERSONAS_REMOTE_CACHE_NAMESPACE,
  backend: "json",
  currentVersion: 1,
  migrations: [],
  encrypted: false,
  defaults: () => ({ schemaVersion: 1, users: {} }),
  validate: isAgentPersonaRemoteCacheEntryV1,
}

function isAgentPersonaRemoteCacheEntryV1(value: unknown): value is AgentPersonaRemoteCacheEntryV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.users)) return false
  return Object.entries(value.users).every(([userId, bucket]) =>
    typeof userId === "string"
    && userId.trim().length > 0
    && isRecord(bucket)
    && typeof bucket.syncedAt === "string"
    && bucket.syncedAt.trim().length > 0
    && !Number.isNaN(Date.parse(bucket.syncedAt))
    && Array.isArray(bucket.items)
    && bucket.items.every((item) => agentPersonaSchema.safeParse(item).success),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
