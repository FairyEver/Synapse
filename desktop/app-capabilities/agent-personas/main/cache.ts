import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type { AgentPersonaRemoteCacheEntryV1 } from "../../../electron/runtime/data-repo/schemas/agent-persona-remote-cache"
import type { AgentPersona } from "../shared/schema"

type AgentPersonaRemoteCacheItem = AgentPersonaRemoteCacheEntryV1["users"][string]["items"][number]

export type AgentPersonaCacheBucket = {
  readonly syncedAt: string
  readonly items: readonly AgentPersona[]
}

export class AgentPersonaCache {
  constructor(private readonly namespace: DataNamespace<AgentPersonaRemoteCacheEntryV1>) {}

  async read(userId: string): Promise<AgentPersonaCacheBucket | null> {
    const cache = await this.namespace.getSingleton()
    const bucket = cache?.users[userId]
    if (!bucket) return null
    return { syncedAt: bucket.syncedAt, items: bucket.items as AgentPersona[] }
  }

  async write(userId: string, items: readonly AgentPersona[], syncedAt: string): Promise<void> {
    const current = await this.namespace.getSingleton() ?? { schemaVersion: 1 as const, users: {} }
    await this.namespace.setSingleton({
      schemaVersion: 1,
      users: {
        ...current.users,
        [userId]: {
          syncedAt,
          items: items.map(toRemoteCacheItem),
        },
      },
    })
  }
}

function toRemoteCacheItem(item: AgentPersona): AgentPersonaRemoteCacheItem {
  const base = {
    id: item.id,
    schemaVersion: item.schemaVersion,
    name: item.name,
    description: item.description,
    systemPrompt: item.systemPrompt,
    providerModel: item.providerModel,
    toolPolicy: item.toolPolicy ?? null,
    version: item.version ?? 1,
    ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
  }

  return item.source === "builtin"
    ? { ...base, source: "builtin", readonly: true }
    : { ...base, source: "user", readonly: false }
}
