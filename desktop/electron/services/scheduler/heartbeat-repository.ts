import { randomUUID } from "node:crypto"

import type { DataNamespace, HeartbeatEntryV1 } from "../../runtime/data-repo"
import type { HeartbeatCreateInput, HeartbeatUpdateInput, ScheduledJobRunResult } from "./types"

export interface HeartbeatRepositoryDeps {
  readonly heartbeats: DataNamespace<HeartbeatEntryV1>
  readonly now?: () => Date
  readonly idFactory?: (projectId: string, sessionKey: string) => string
}

export class HeartbeatRepository {
  private readonly heartbeats: DataNamespace<HeartbeatEntryV1>
  private readonly now: () => Date
  private readonly idFactory: (projectId: string, sessionKey: string) => string

  constructor(deps: HeartbeatRepositoryDeps) {
    this.heartbeats = deps.heartbeats
    this.now = deps.now ?? (() => new Date())
    this.idFactory = deps.idFactory ?? ((projectId, sessionKey) =>
      `heartbeat:${projectId}:${Buffer.from(sessionKey).toString("base64url")}:${randomUUID()}`)
  }

  async upsert(input: HeartbeatCreateInput): Promise<HeartbeatEntryV1> {
    const existing = await this.findBySession(input.projectId, input.sessionKey)
    if (existing) {
      return this.update(existing.id, input)
    }
    const now = this.isoNow()
    const entry: HeartbeatEntryV1 = {
      id: this.idFactory(input.projectId, input.sessionKey),
      schemaVersion: 1,
      projectId: input.projectId,
      platform: input.platform,
      connectorId: input.connectorId,
      sessionKey: input.sessionKey,
      channelKey: input.channelKey,
      workspaceKey: input.workspaceKey,
      workspacePath: input.workspacePath,
      replyCtx: input.replyCtx,
      enabled: input.enabled ?? true,
      paused: input.paused ?? false,
      intervalMins: input.intervalMins,
      prompt: input.prompt ?? defaultHeartbeatPrompt,
      silent: input.silent ?? false,
      mute: input.mute ?? false,
      timeoutMins: input.timeoutMins,
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    }
    validateHeartbeat(entry)
    await this.heartbeats.upsert(entry)
    return entry
  }

  async update(id: string, patch: HeartbeatUpdateInput): Promise<HeartbeatEntryV1> {
    const existing = await this.require(id)
    const next: HeartbeatEntryV1 = {
      ...existing,
      ...definedPatch({
        connectorId: patch.connectorId,
        sessionKey: patch.sessionKey,
        channelKey: patch.channelKey,
        workspaceKey: patch.workspaceKey,
        workspacePath: patch.workspacePath,
        replyCtx: patch.replyCtx,
        enabled: patch.enabled,
        paused: patch.paused,
        intervalMins: patch.intervalMins,
        prompt: patch.prompt,
        silent: patch.silent,
        mute: patch.mute,
        timeoutMins: patch.timeoutMins,
      }),
      updatedAt: this.isoNow(),
    }
    validateHeartbeat(next)
    await this.heartbeats.upsert(next)
    return next
  }

  get(id: string): Promise<HeartbeatEntryV1 | null> {
    return this.heartbeats.get(id)
  }

  listByProject(projectId: string): Promise<HeartbeatEntryV1[]> {
    return this.heartbeats.list({ projectId } as Partial<HeartbeatEntryV1>)
  }

  listAll(): Promise<HeartbeatEntryV1[]> {
    return this.heartbeats.list()
  }

  async findBySession(projectId: string, sessionKey: string): Promise<HeartbeatEntryV1 | null> {
    const entries = await this.heartbeats.list({ projectId, sessionKey } as Partial<HeartbeatEntryV1>)
    return entries[0] ?? null
  }

  async markRun(id: string, result: ScheduledJobRunResult): Promise<HeartbeatEntryV1 | null> {
    const existing = await this.heartbeats.get(id)
    if (!existing) return null
    const now = this.isoNow()
    const next: HeartbeatEntryV1 = {
      ...existing,
      lastRunAt: now,
      lastError: result.error,
      lastStatus: result.status,
      runCount: existing.runCount + 1,
      updatedAt: now,
    }
    await this.heartbeats.upsert(next)
    return next
  }

  async markScheduled(id: string, nextRunAt: string | undefined): Promise<HeartbeatEntryV1 | null> {
    const existing = await this.heartbeats.get(id)
    if (!existing) return null
    const next = { ...existing, nextRunAt, updatedAt: this.isoNow() }
    await this.heartbeats.upsert(next)
    return next
  }

  private async require(id: string): Promise<HeartbeatEntryV1> {
    const entry = await this.heartbeats.get(id)
    if (!entry) throw new Error(`Heartbeat "${id}" was not found`)
    return entry
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

export const defaultHeartbeatPrompt = "检查当前项目状态，如有需要请给出简短提醒。"

function validateHeartbeat(entry: HeartbeatEntryV1): void {
  if (!Number.isInteger(entry.intervalMins) || entry.intervalMins < 1) {
    throw new Error("intervalMins must be >= 1")
  }
  if (entry.timeoutMins !== undefined && (!Number.isInteger(entry.timeoutMins) || entry.timeoutMins < 0)) {
    throw new Error("timeoutMins must be >= 0")
  }
  if (!entry.prompt.trim()) throw new Error("prompt is required")
}

function definedPatch<T extends Record<string, unknown>>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}
