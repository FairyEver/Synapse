import { randomUUID } from "node:crypto"

import type { DataNamespace } from "../../runtime/data-repo"
import type {
  ScheduledTaskRunEntry,
  ScheduledTaskRunFinishInput,
  ScheduledTaskRunTrigger,
} from "./types"

const MAX_RUNS_PER_TASK = 100

export interface ScheduledTaskRunRepositoryDeps {
  readonly runs: DataNamespace<ScheduledTaskRunEntry>
  readonly now?: () => Date
  readonly idFactory?: (taskId: string, index: number) => string
}

export class ScheduledTaskRunRepository {
  private readonly runs: DataNamespace<ScheduledTaskRunEntry>
  private readonly now: () => Date
  private readonly idFactory: (taskId: string, index: number) => string
  private nextIndex = 0

  constructor(deps: ScheduledTaskRunRepositoryDeps) {
    this.runs = deps.runs
    this.now = deps.now ?? (() => new Date())
    this.idFactory = deps.idFactory ?? (() => `run:${randomUUID()}`)
  }

  async start(taskId: string, triggeredBy: ScheduledTaskRunTrigger): Promise<ScheduledTaskRunEntry> {
    this.nextIndex += 1
    const run: ScheduledTaskRunEntry = {
      id: this.idFactory(taskId, this.nextIndex),
      schemaVersion: 2,
      taskId,
      startedAt: this.isoNow(),
      status: "running",
      triggeredBy,
    }
    await this.runs.upsert(run)
    return run
  }

  async finish(id: string, input: ScheduledTaskRunFinishInput): Promise<ScheduledTaskRunEntry> {
    const existing = await this.require(id)
    const next: ScheduledTaskRunEntry = {
      ...existing,
      finishedAt: this.isoNow(),
      status: input.status,
      result: input.result,
      error: input.error,
    }
    await this.runs.upsert(next)
    await this.prune(existing.taskId, id)
    return next
  }

  listByTask(taskId: string, options?: { readonly limit?: number }): Promise<ScheduledTaskRunEntry[]> {
    return this.listSorted(taskId, options?.limit)
  }

  async listRunning(): Promise<ScheduledTaskRunEntry[]> {
    const runs = await this.runs.list({ status: "running" } as Partial<ScheduledTaskRunEntry>)
    return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }

  get(id: string): Promise<ScheduledTaskRunEntry | null> {
    return this.runs.get(id)
  }

  private async prune(taskId: string, keepRunId?: string): Promise<void> {
    const runs = await this.listSorted(taskId)
    if (runs.length <= MAX_RUNS_PER_TASK) return
    const hasKeepRun = keepRunId !== undefined && runs.some((run) => run.id === keepRunId)
    const keepLimit = hasKeepRun ? MAX_RUNS_PER_TASK - 1 : MAX_RUNS_PER_TASK
    const stale = runs
      .filter((run) => run.id !== keepRunId)
      .slice(keepLimit)
    await Promise.all(stale.map((run) => this.runs.remove(run.id)))
  }

  private async listSorted(taskId: string, limit?: number): Promise<ScheduledTaskRunEntry[]> {
    const runs = await this.runs.list({ taskId } as Partial<ScheduledTaskRunEntry>)
    const sorted = runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    return limit === undefined ? sorted : sorted.slice(0, limit)
  }

  private async require(id: string): Promise<ScheduledTaskRunEntry> {
    const run = await this.runs.get(id)
    if (!run) throw new Error(`Scheduled task run "${id}" was not found`)
    return run
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}
