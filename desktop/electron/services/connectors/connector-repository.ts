import type {
  ConnectorDedupeStateV1,
  ConnectorEntryV1,
  ConnectorReconnectStateV1,
  ConnectorStatusV1,
  DataNamespace,
} from "../../runtime/data-repo"
import type {
  ConnectorAllowlist,
  ConnectorCreateInput,
  ConnectorPlatform,
  ConnectorSessionKeyPolicy,
  ConnectorUpdateInput,
  FeishuConnectorSummary,
} from "./types"

const DEFAULT_DEDUPE_TTL_MS = 60_000

export interface ConnectorRepositoryDeps {
  readonly connectors: DataNamespace<ConnectorEntryV1>
  readonly now?: () => Date
}

export class ConnectorRepository {
  private readonly connectors: DataNamespace<ConnectorEntryV1>
  private readonly now: () => Date

  constructor(deps: ConnectorRepositoryDeps) {
    this.connectors = deps.connectors
    this.now = deps.now ?? (() => new Date())
  }

  connectorId(platform: ConnectorPlatform, projectId: string): string {
    return `${platform}:${projectId}`
  }

  async create(input: ConnectorCreateInput): Promise<ConnectorEntryV1> {
    const now = this.isoNow()
    const id = this.connectorId(input.platform, input.projectId)
    const entry: ConnectorEntryV1 = {
      id,
      schemaVersion: 1,
      projectId: input.projectId,
      platform: input.platform,
      secretRef: input.secretRef,
      status: input.status ?? "disabled",
      allowlist: input.allowlist ?? defaultAllowlist(input.ownerOpenId),
      sessionKeyPolicy: input.sessionKeyPolicy ?? defaultSessionKeyPolicy(),
      reconnect: input.reconnect ?? defaultReconnectState(),
      dedupe: input.dedupe ?? defaultDedupeState(now),
      appId: input.appId,
      ownerOpenId: input.ownerOpenId,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    }
    await this.connectors.upsert(entry)
    return entry
  }

  async upsert(input: ConnectorCreateInput): Promise<ConnectorEntryV1> {
    const existing = await this.getByProject(input.projectId, input.platform)
    if (!existing) return this.create(input)
    return this.update(existing.id, {
      secretRef: input.secretRef,
      status: input.status,
      allowlist: input.allowlist ?? mergeOwnerIntoAllowlist(existing.allowlist, input.ownerOpenId),
      sessionKeyPolicy: input.sessionKeyPolicy,
      reconnect: input.reconnect,
      dedupe: input.dedupe,
      appId: input.appId,
      ownerOpenId: input.ownerOpenId,
      metadata: input.metadata,
    })
  }

  async update(id: string, input: ConnectorUpdateInput): Promise<ConnectorEntryV1> {
    const existing = await this.connectors.get(id)
    if (!existing) {
      throw new Error(`Connector "${id}" was not found`)
    }
    const now = this.isoNow()
    const next: ConnectorEntryV1 = {
      ...existing,
      ...definedRecord({
        secretRef: input.secretRef,
        status: input.status,
        allowlist: input.allowlist,
        sessionKeyPolicy: input.sessionKeyPolicy,
        reconnect: input.reconnect,
        dedupe: input.dedupe,
        appId: input.appId,
        ownerOpenId: input.ownerOpenId,
        metadata: input.metadata,
      }),
      reconnect: mergeReconnect(existing.reconnect, input),
      updatedAt: now,
    }
    await this.connectors.upsert(next)
    return next
  }

  get(id: string): Promise<ConnectorEntryV1 | null> {
    return this.connectors.get(id)
  }

  getByProject(
    projectId: string,
    platform: ConnectorPlatform,
  ): Promise<ConnectorEntryV1 | null> {
    return this.connectors.get(this.connectorId(platform, projectId))
  }

  list(projectId?: string): Promise<ConnectorEntryV1[]> {
    return this.connectors.list(projectId ? { projectId } : undefined)
  }

  async remove(id: string): Promise<void> {
    await this.connectors.remove(id)
  }

  updateStatus(
    id: string,
    status: ConnectorStatusV1,
    options: { readonly lastConnectedAt?: string; readonly lastError?: string } = {},
  ): Promise<ConnectorEntryV1> {
    return this.update(id, {
      status,
      lastConnectedAt: options.lastConnectedAt,
      lastError: options.lastError,
    })
  }

  updateReconnect(
    id: string,
    reconnect: ConnectorReconnectStateV1,
  ): Promise<ConnectorEntryV1> {
    return this.update(id, { reconnect })
  }

  updateDedupe(id: string, dedupe: ConnectorDedupeStateV1): Promise<ConnectorEntryV1> {
    return this.update(id, { dedupe })
  }

  toFeishuSummary(connector: ConnectorEntryV1): FeishuConnectorSummary {
    return {
      id: connector.id,
      projectId: connector.projectId,
      platform: "feishu",
      appId: stringValue(connector.appId),
      ownerOpenId: stringValue(connector.ownerOpenId),
      status: connector.status,
      allowlist: connector.allowlist,
      sessionKeyPolicy: connector.sessionKeyPolicy,
      reconnect: connector.reconnect,
      dedupe: connector.dedupe,
      lastConnectedAt: stringValue(connector.lastConnectedAt ?? connector.reconnect?.lastConnectedAt),
      lastError: stringValue(connector.lastError ?? connector.reconnect?.lastError),
      createdAt: connector.createdAt,
      updatedAt: connector.updatedAt,
    }
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

export function defaultAllowlist(ownerOpenId?: string): ConnectorAllowlist {
  const owner = ownerOpenId?.trim()
  if (!owner) return { mode: "all" }
  return { mode: "users", userIds: [owner], adminIds: [owner] }
}

export function defaultSessionKeyPolicy(): ConnectorSessionKeyPolicy {
  return { mode: "per-user", format: "feishu:<chatID>:<userID>" }
}

export function defaultReconnectState(): ConnectorReconnectStateV1 {
  return { attempts: 0 }
}

export function defaultDedupeState(ignoreBefore: string): ConnectorDedupeStateV1 {
  return {
    ttlMs: DEFAULT_DEDUPE_TTL_MS,
    lastMessageIds: [],
    ignoreBefore,
  }
}

export function mergeOwnerIntoAllowlist(
  allowlist: ConnectorAllowlist | undefined,
  ownerOpenId: string | undefined,
): ConnectorAllowlist | undefined {
  const owner = ownerOpenId?.trim()
  if (!owner) return allowlist
  if (!allowlist || allowlist.mode === "all") return defaultAllowlist(owner)
  return {
    ...allowlist,
    userIds: uniqueStrings([...(allowlist.userIds ?? []), owner]),
    adminIds: uniqueStrings([...(allowlist.adminIds ?? []), owner]),
  }
}

function mergeReconnect(
  existing: ConnectorReconnectStateV1 | undefined,
  input: ConnectorUpdateInput,
): ConnectorReconnectStateV1 | undefined {
  if (input.reconnect) return input.reconnect
  if (input.lastConnectedAt === undefined && input.lastError === undefined) {
    return existing
  }
  return {
    attempts: existing?.attempts ?? 0,
    lastConnectedAt: input.lastConnectedAt ?? existing?.lastConnectedAt,
    nextRetryAt: existing?.nextRetryAt,
    lastError: input.lastError ?? existing?.lastError,
  }
}

function definedRecord<T extends Record<string, unknown>>(record: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}
