import { randomUUID } from "node:crypto"

import type { DataNamespace, ScheduledJobEntryV1 } from "../../runtime/data-repo"
import { nextCronRun, validateCronExpression } from "./cron-expression"
import type {
  ScheduledJobCreateInput,
  ScheduledJobRunResult,
  ScheduledJobUpdateInput,
} from "./types"

export interface ScheduledJobRepositoryDeps {
  readonly jobs: DataNamespace<ScheduledJobEntryV1>
  readonly now?: () => Date
  readonly idFactory?: () => string
}

export class ScheduledJobRepository {
  private readonly jobs: DataNamespace<ScheduledJobEntryV1>
  private readonly now: () => Date
  private readonly idFactory: () => string

  constructor(deps: ScheduledJobRepositoryDeps) {
    this.jobs = deps.jobs
    this.now = deps.now ?? (() => new Date())
    this.idFactory = deps.idFactory ?? (() => `scheduled:${randomUUID()}`)
  }

  async create(input: ScheduledJobCreateInput): Promise<ScheduledJobEntryV1> {
    const now = this.isoNow()
    const job: ScheduledJobEntryV1 = {
      id: this.idFactory(),
      schemaVersion: 1,
      projectId: input.projectId,
      platform: input.platform,
      connectorId: input.connectorId,
      sessionKey: input.sessionKey,
      channelKey: input.channelKey,
      channelName: input.channelName,
      workspaceKey: input.workspaceKey,
      workspacePath: input.workspacePath,
      replyCtx: input.replyCtx,
      kind: input.kind,
      cronExpr: input.cronExpr,
      prompt: input.prompt,
      exec: input.exec,
      workDir: input.workDir,
      description: input.description,
      enabled: input.enabled ?? true,
      silent: input.silent ?? false,
      mute: input.mute ?? false,
      sessionMode: normalizeSessionMode(input.sessionMode),
      modeOverride: input.modeOverride,
      timeoutMins: input.timeoutMins,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
      nextRunAt: input.enabled === false ? undefined : nextCronRun(input.cronExpr, this.now()).toISOString(),
      runCount: 0,
    }
    validateScheduledJob(job)
    await this.jobs.upsert(job)
    return job
  }

  async update(id: string, patch: ScheduledJobUpdateInput): Promise<ScheduledJobEntryV1> {
    const existing = await this.require(id)
    const next: ScheduledJobEntryV1 = {
      ...existing,
      ...definedPatch({
        cronExpr: patch.cronExpr,
        prompt: patch.prompt,
        exec: patch.exec,
        workDir: patch.workDir,
        description: patch.description,
        enabled: patch.enabled,
        silent: patch.silent,
        mute: patch.mute,
        modeOverride: patch.modeOverride,
        timeoutMins: patch.timeoutMins,
        workspaceKey: patch.workspaceKey,
        workspacePath: patch.workspacePath,
        replyCtx: patch.replyCtx,
      }),
      sessionMode: patch.sessionMode === undefined
        ? existing.sessionMode
        : normalizeSessionMode(patch.sessionMode),
      updatedAt: this.isoNow(),
    }
    validateScheduledJob(next)
    await this.jobs.upsert(next)
    return next
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.jobs.get(id)
    if (!existing) return false
    await this.jobs.remove(id)
    return true
  }

  get(id: string): Promise<ScheduledJobEntryV1 | null> {
    return this.jobs.get(id)
  }

  listByProject(projectId: string): Promise<ScheduledJobEntryV1[]> {
    return this.jobs.list({ projectId } as Partial<ScheduledJobEntryV1>)
  }

  listAll(): Promise<ScheduledJobEntryV1[]> {
    return this.jobs.list()
  }

  listBySession(projectId: string, sessionKey: string): Promise<ScheduledJobEntryV1[]> {
    return this.jobs.list({ projectId, sessionKey } as Partial<ScheduledJobEntryV1>)
  }

  async setEnabled(id: string, enabled: boolean): Promise<ScheduledJobEntryV1> {
    return this.update(id, { enabled })
  }

  async setMuted(id: string, mute: boolean): Promise<ScheduledJobEntryV1> {
    return this.update(id, { mute })
  }

  async markRun(id: string, result: ScheduledJobRunResult): Promise<ScheduledJobEntryV1 | null> {
    const existing = await this.jobs.get(id)
    if (!existing) return null
    const next: ScheduledJobEntryV1 = {
      ...existing,
      lastRunAt: this.isoNow(),
      lastError: result.error,
      lastStatus: result.status,
      runCount: existing.runCount + 1,
      updatedAt: this.isoNow(),
    }
    await this.jobs.upsert(next)
    return next
  }

  async markScheduled(id: string, nextRunAt: string | undefined): Promise<ScheduledJobEntryV1 | null> {
    const existing = await this.jobs.get(id)
    if (!existing) return null
    const next: ScheduledJobEntryV1 = {
      ...existing,
      nextRunAt,
      updatedAt: this.isoNow(),
    }
    await this.jobs.upsert(next)
    return next
  }

  private async require(id: string): Promise<ScheduledJobEntryV1> {
    const job = await this.jobs.get(id)
    if (!job) throw new Error(`Scheduled job "${id}" was not found`)
    return job
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

export function normalizeSessionMode(value: ScheduledJobCreateInput["sessionMode"]): "reuse" | "new_per_run" {
  switch (value) {
    case "new_per_run":
    case "new-per-run":
      return "new_per_run"
    case undefined:
    case "reuse":
      return "reuse"
    default:
      throw new Error(`Invalid sessionMode: ${String(value)}`)
  }
}

function validateScheduledJob(job: ScheduledJobEntryV1): void {
  validateCronExpression(job.cronExpr)
  if (job.timeoutMins !== undefined && (!Number.isInteger(job.timeoutMins) || job.timeoutMins < 0)) {
    throw new Error("timeoutMins must be >= 0")
  }
  const hasPrompt = Boolean(job.prompt?.trim())
  const hasExec = Boolean(job.exec?.trim())
  if (hasPrompt && hasExec) throw new Error("prompt and exec are mutually exclusive")
  if (!hasPrompt && !hasExec) throw new Error("either prompt or exec is required")
  if (job.kind === "prompt" && !hasPrompt) throw new Error("prompt job requires prompt")
  if (job.kind === "exec" && !hasExec) throw new Error("exec job requires exec")
}

function definedPatch<T extends Record<string, unknown>>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}
