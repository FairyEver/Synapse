import { randomUUID } from "node:crypto"

import type { DataNamespace, ScheduledTaskRunEntryV1 } from "../../runtime/data-repo"
import type { ScheduledTaskRunFinishInput, ScheduledTaskRunTrigger } from "./types"

const MAX_RUNS_PER_TASK = 100

export interface ScheduledTaskRunRepositoryDeps {
  readonly runs: DataNamespace<ScheduledTaskRunEntryV1>
  readonly now?: () => Date
  readonly idFactory?: (taskId: string, index: number) => string
}

export class ScheduledTaskRunRepository {
  private readonly runs: DataNamespace<ScheduledTaskRunEntryV1>
  private readonly now: () => Date
  private readonly idFactory: (taskId: string, index: number) => string
  private nextIndex = 0

  constructor(deps: ScheduledTaskRunRepositoryDeps) {
    this.runs = deps.runs
    this.now = deps.now ?? (() => new Date())
    this.idFactory = deps.idFactory ?? (() => `run:${randomUUID()}`)
  }

  async start(taskId: string, triggeredBy: ScheduledTaskRunTrigger): Promise<ScheduledTaskRunEntryV1> {
    this.nextIndex += 1
    const run: ScheduledTaskRunEntryV1 = {
      id: this.idFactory(taskId, this.nextIndex),
      schemaVersion: 1,
      taskId,
      startedAt: this.isoNow(),
      status: "running",
      triggeredBy,
    }
    await this.runs.upsert(run)
    return run
  }

  async finish(id: string, input: ScheduledTaskRunFinishInput): Promise<ScheduledTaskRunEntryV1> {
    const existing = await this.require(id)
    const next: ScheduledTaskRunEntryV1 = {
      ...existing,
      finishedAt: this.isoNow(),
      status: input.status,
      exitCode: input.exitCode,
      stdout: input.stdout,
      stderr: input.stderr,
      error: input.error,
    }
    await this.runs.upsert(next)
    await this.prune(existing.taskId)
    return next
  }

  listByTask(taskId: string, options?: { readonly limit?: number }): Promise<ScheduledTaskRunEntryV1[]> {
    return this.listSorted(taskId, options?.limit)
  }

  get(id: string): Promise<ScheduledTaskRunEntryV1 | null> {
    return this.runs.get(id)
  }

  private async prune(taskId: string): Promise<void> {
    const runs = await this.listSorted(taskId)
    const stale = runs.slice(MAX_RUNS_PER_TASK)
    await Promise.all(stale.map((run) => this.runs.remove(run.id)))
  }

  private async listSorted(taskId: string, limit?: number): Promise<ScheduledTaskRunEntryV1[]> {
    const runs = await this.runs.list({ taskId } as Partial<ScheduledTaskRunEntryV1>)
    const sorted = runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    return limit === undefined ? sorted : sorted.slice(0, limit)
  }

  private async require(id: string): Promise<ScheduledTaskRunEntryV1> {
    const run = await this.runs.get(id)
    if (!run) throw new Error(`Scheduled task run "${id}" was not found`)
    return run
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}
