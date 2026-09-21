import { Injectable } from "@nestjs/common"
import type { LiveClientDisconnectReason, LiveClientInstance } from "./live.types"

export interface LiveClientRegistryOptions {
  readonly heartbeatTimeoutMs?: number
  readonly offlineRetentionMs?: number
  readonly staleGraceMs?: number
}

interface RegisterLiveClientInput {
  readonly userId: string
  readonly clientInstanceId: string
  readonly connectionId: string
  readonly appVersion: string
  readonly platform: string
  readonly deviceName: string
  readonly now: Date
  readonly onSupersede?: (connectionId: string) => void
}

interface MarkDisconnectedInput {
  readonly connectionId: string
  readonly now: Date
  readonly reason: LiveClientDisconnectReason
}

@Injectable()
export class LiveClientRegistry {
  private readonly clients = new Map<string, LiveClientInstance>()
  /** Secondary index: connectionId -> client key, kept in sync with `clients`. */
  private readonly connectionKeys = new Map<string, string>()
  private heartbeatTimeoutMs = 45_000
  private offlineRetentionMs = 60 * 60_000
  private staleGraceMs = 45_000

  static withOptions(options: LiveClientRegistryOptions): LiveClientRegistry {
    const registry = new LiveClientRegistry()
    registry.configure(options)
    return registry
  }

  private configure(options: LiveClientRegistryOptions): void {
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 45_000
    this.offlineRetentionMs = options.offlineRetentionMs ?? 60 * 60_000
    this.staleGraceMs = options.staleGraceMs ?? 45_000
  }

  register(input: RegisterLiveClientInput): LiveClientInstance {
    const key = this.createKey(input.userId, input.clientInstanceId)
    const existing = this.clients.get(key)

    if (
      existing?.connectionId &&
      existing.connectionId !== input.connectionId &&
      existing.status !== "offline"
    ) {
      input.onSupersede?.(existing.connectionId)
    }

    if (existing?.connectionId && existing.connectionId !== input.connectionId) {
      this.unlinkConnection(existing.connectionId, key)
    }

    const timestamp = input.now.toISOString()
    const client: LiveClientInstance = {
      userId: input.userId,
      clientInstanceId: input.clientInstanceId,
      connectionId: input.connectionId,
      status: "online",
      appVersion: input.appVersion,
      platform: input.platform,
      deviceName: input.deviceName,
      connectedAt: timestamp,
      lastSeenAt: timestamp,
    }

    this.clients.set(key, client)
    this.linkConnection(input.connectionId, key)
    return client
  }

  touch(connectionId: string, now: Date): LiveClientInstance | undefined {
    const entry = this.findByConnectionId(connectionId)

    if (!entry) {
      return undefined
    }

    const client: LiveClientInstance = {
      ...entry.client,
      status: "online",
      lastSeenAt: now.toISOString(),
      disconnectedAt: undefined,
      disconnectReason: undefined,
    }

    this.clients.set(entry.key, client)
    return client
  }

  markDisconnected(input: MarkDisconnectedInput): LiveClientInstance | undefined {
    const entry = this.findByConnectionId(input.connectionId)

    if (!entry) {
      return undefined
    }

    return this.markOffline(entry.key, entry.client, input.now, input.reason)
  }

  markStaleClients(now: Date): LiveClientInstance[] {
    const changedClients: LiveClientInstance[] = []

    for (const [key, client] of this.clients) {
      if (client.status === "offline") {
        if (this.isOfflineExpired(client, now)) {
          this.unlinkConnection(client.connectionId, key)
          this.clients.delete(key)
        }
        continue
      }

      if (!client.lastSeenAt) {
        continue
      }

      const ageMs = now.getTime() - new Date(client.lastSeenAt).getTime()

      if (ageMs > this.heartbeatTimeoutMs + this.staleGraceMs) {
        changedClients.push(this.markOffline(key, client, now, "heartbeat_timeout"))
        continue
      }

      if (ageMs > this.heartbeatTimeoutMs && client.status !== "stale") {
        const staleClient: LiveClientInstance = {
          ...client,
          status: "stale",
        }
        this.clients.set(key, staleClient)
        changedClients.push(staleClient)
      }
    }

    return changedClients
  }

  listAll(): LiveClientInstance[] {
    return Array.from(this.clients.entries())
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([, client]) => client)
  }

  listByUser(userId: string): LiveClientInstance[] {
    const matched: Array<[string, LiveClientInstance]> = []

    for (const entry of this.clients) {
      if (entry[1].userId === userId) {
        matched.push(entry)
      }
    }

    return matched
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([, client]) => client)
  }

  listOnlineByUser(userId: string): LiveClientInstance[] {
    return this.listByUser(userId).filter((client) => client.status === "online" && Boolean(client.connectionId))
  }

  private markOffline(
    key: string,
    client: LiveClientInstance,
    now: Date,
    reason: LiveClientDisconnectReason,
  ): LiveClientInstance {
    const offlineClient: LiveClientInstance = {
      ...client,
      connectionId: null,
      status: "offline",
      disconnectedAt: now.toISOString(),
      disconnectReason: reason,
    }

    this.unlinkConnection(client.connectionId, key)
    this.clients.set(key, offlineClient)
    return offlineClient
  }

  private findByConnectionId(
    connectionId: string,
  ): { readonly key: string; readonly client: LiveClientInstance } | undefined {
    const key = this.connectionKeys.get(connectionId)

    if (key === undefined) {
      return undefined
    }

    const client = this.clients.get(key)

    if (!client || client.connectionId !== connectionId) {
      return undefined
    }

    return { key, client }
  }

  private linkConnection(connectionId: string, key: string): void {
    this.connectionKeys.set(connectionId, key)
  }

  private unlinkConnection(connectionId: string | null, key: string): void {
    if (!connectionId) {
      return
    }

    if (this.connectionKeys.get(connectionId) === key) {
      this.connectionKeys.delete(connectionId)
    }
  }

  private createKey(userId: string, clientInstanceId: string): string {
    return `${userId}:${clientInstanceId}`
  }

  private isOfflineExpired(client: LiveClientInstance, now: Date): boolean {
    const observedAt = client.disconnectedAt ?? client.lastSeenAt
    if (!observedAt) return false
    const observedTime = new Date(observedAt).getTime()
    return Number.isFinite(observedTime) && now.getTime() - observedTime > this.offlineRetentionMs
  }
}
