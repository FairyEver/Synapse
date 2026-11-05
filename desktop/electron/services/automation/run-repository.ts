import { randomUUID } from "node:crypto"
import { claudeCodeActionManifest } from "../../../action-packages/builtin/claude-code/manifest"

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
      readonly reservedRunId?: string
    },
  ): Promise<AutomationRun> {
    this.nextIndex += 1
    if (input.reservedRunId && await this.runs.get(input.reservedRunId)) throw new Error("运行记录已存在，未重复执行")
    const run: AutomationRun = {
      id: input.reservedRunId ?? this.idFactory(automationId, this.nextIndex),
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
    const { pendingOutputs, ...base } = existing
    // Receipt recovery can refine an already-failed run's diagnostic after generic startup recovery.
    const terminalOutputs = pendingOutputs ?? (existing.executorType === claudeCodeActionManifest.id ? existing.result?.outputs : undefined)
    const next: AutomationRun = {
      ...base,
      finishedAt: this.isoNow(),
      status: input.status,
      result: terminalOutputs ? {
        ...input.result, status: input.result?.status ?? (input.status === "skipped" ? "cancelled" : input.status),
        outputs: { ...terminalOutputs, ...input.result?.outputs },
      } : input.result,
      error: input.error,
    }
    await this.runs.upsert(next)
    await this.prune(existing.automationId, id)
    return next
  }

  async updateOutputs(id: string, outputs: Record<string, unknown>): Promise<void> {
    const existing = await this.require(id)
    if (existing.status !== "running") return
    await this.runs.upsert({ ...existing, pendingOutputs: { ...existing.pendingOutputs, ...outputs } })
  }

  listByAutomation(automationId: string, options?: { readonly limit?: number }): Promise<AutomationRun[]> {
    return this.listSorted(automationId, options?.limit)
  }

  async listRunning(): Promise<AutomationRun[]> {
    const runs = await this.runs.list({ status: "running" } as Partial<AutomationRun>)
    return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
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
