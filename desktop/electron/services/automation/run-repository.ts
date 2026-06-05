import { randomUUID } from "node:crypto"

import type { DataNamespace } from "../../runtime/data-repo"
import type {
  AutomationRun,
  AutomationRunFinishInput,
  AutomationRunTrigger,
} from "./types"

const MAX_RUNS_PER_AUTOMATION = 100

export interface AutomationRunRepositoryDeps {
  readonly runs: DataNamespace<AutomationRun>
  readonly now?: () => Date
  readonly idFactory?: (automationId: string, index: number) => string
}

export class AutomationRunRepository {
  private readonly runs: DataNamespace<AutomationRun>
  private readonly now: () => Date
  private readonly idFactory: (automationId: string, index: number) => string
  private nextIndex = 0

  constructor(deps: AutomationRunRepositoryDeps) {
    this.runs = deps.runs
    this.now = deps.now ?? (() => new Date())
    this.idFactory = deps.idFactory ?? (() => `automation-run:${randomUUID()}`)
  }

  async start(
    automationId: string,
    triggeredBy: AutomationRunTrigger,
    input: {
      readonly triggerType: string
      readonly executorType: string
    },
  ): Promise<AutomationRun> {
    this.nextIndex += 1
    const run: AutomationRun = {
      id: this.idFactory(automationId, this.nextIndex),
      schemaVersion: 1,
      automationId,
      startedAt: this.isoNow(),
      status: "running",
      triggeredBy,
      triggerType: input.triggerType,
      executorType: input.executorType,
    }
    await this.runs.upsert(run)
    return run
  }

  async finish(id: string, input: AutomationRunFinishInput): Promise<AutomationRun> {
    const existing = await this.require(id)
    const next: AutomationRun = {
      ...existing,
      finishedAt: this.isoNow(),
      status: input.status,
      result: input.result,
      error: input.error,
    }
    await this.runs.upsert(next)
    await this.prune(existing.automationId, id)
    return next
  }

  listByAutomation(automationId: string, options?: { readonly limit?: number }): Promise<AutomationRun[]> {
    return this.listSorted(automationId, options?.limit)
  }

  async deleteByAutomation(automationId: string): Promise<number> {
    const runs = await this.listSorted(automationId)
    await Promise.all(runs.map((run) => this.runs.remove(run.id)))
    return runs.length
  }

  get(id: string): Promise<AutomationRun | null> {
    return this.runs.get(id)
  }

  private async prune(automationId: string, keepRunId?: string): Promise<void> {
    const runs = await this.listSorted(automationId)
    if (runs.length <= MAX_RUNS_PER_AUTOMATION) return
    const hasKeepRun = keepRunId !== undefined && runs.some((run) => run.id === keepRunId)
    const keepLimit = hasKeepRun ? MAX_RUNS_PER_AUTOMATION - 1 : MAX_RUNS_PER_AUTOMATION
    const stale = runs
      .filter((run) => run.id !== keepRunId)
      .slice(keepLimit)
    await Promise.all(stale.map((run) => this.runs.remove(run.id)))
  }

  private async listSorted(automationId: string, limit?: number): Promise<AutomationRun[]> {
    const runs = await this.runs.list({ automationId } as Partial<AutomationRun>)
    const sorted = runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    return limit === undefined ? sorted : sorted.slice(0, limit)
  }

  private async require(id: string): Promise<AutomationRun> {
    const run = await this.runs.get(id)
    if (!run) throw new Error(`Automation run "${id}" was not found`)
    return run
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}
