import { automationFormatIssue } from "../../../automation-trigger-packages/compatibility"
import path from "node:path"
import { Worker } from "node:worker_threads"
import type { DataNamespace } from "../../runtime/data-repo"
import type { AutomationItem } from "./types"
import { isRetiredAutomationExecutor, retiredAutomationExecutorTypes } from "../../../action-packages/automation-executors"

interface CleanupDeps {
  readonly items: {
    list(): Promise<AutomationItem[]>
    deleteNonAgent(id: string): Promise<boolean>
  }
  readonly changes: Pick<DataNamespace<AutomationItem>, "onChange">
  readonly workerPath?: string
  readonly logger: { warn(message: string, metadata: Record<string, unknown>): void }
}

/** Background retirement of configurations, including configurations restored from backups. */
export class RetiredExecutorCleanup {
  private unsubscribe?: () => void
  private worker?: Worker
  private pending?: Promise<void>
  private dirty = false
  private stopped = true

  constructor(private readonly deps: CleanupDeps) {}

  start(): Promise<void> {
    this.stopped = false
    this.unsubscribe ??= this.deps.changes.onChange(change => {
      if (change.kind !== "replace" && !(change.kind === "upsert" && change.value && isRetiredAutomationExecutor(change.value.executor.type))) return
      void this.run().catch(error => this.deps.logger.warn("Automation configuration retirement failed.", {
        boundary: "automation.retired-executor-cleanup",
        errorName: error instanceof Error ? error.name : typeof error,
      }))
    })
    return this.run()
  }

  run(): Promise<void> {
    this.dirty = true
    this.pending ??= this.drain().finally(() => { this.pending = undefined })
    return this.pending
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.unsubscribe?.()
    this.unsubscribe = undefined
    await this.worker?.terminate()
    await this.pending
  }

  private async drain(): Promise<void> {
    while (this.dirty && !this.stopped) {
      this.dirty = false
      const items = await this.deps.items.list()
      if (this.stopped) return
      await this.scan(items
        .filter(item => !automationFormatIssue(item))
        .map(item => ({ id: item.id, executorType: item.executor.type })))
    }
  }

  private scan(candidates: readonly { readonly id: string; readonly executorType: string }[]): Promise<void> {
    const workerPath = this.deps.workerPath ?? path.join(
      __dirname.replace(/([\\/])app\.asar(?=[\\/])/, "$1app.asar.unpacked"),
      "retired-executor-cleanup-worker.js",
    )
    const worker = new Worker(workerPath, {
      workerData: { candidates, retiredExecutorTypes: retiredAutomationExecutorTypes },
      resourceLimits: { maxOldGenerationSizeMb: 64 },
    })
    this.worker = worker
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: unknown) => {
        if (settled) return
        settled = true
        if (this.worker === worker) this.worker = undefined
        if (error) reject(error)
        else resolve()
      }
      worker.on("message", (message: { readonly ids?: string[]; readonly done?: boolean }) => {
        if (message.done) { finish(); return }
        void (async () => {
          for (const id of message.ids ?? []) {
            if (this.stopped) return
            await this.deps.items.deleteNonAgent(id)
          }
          if (!this.stopped) worker.postMessage("next")
        })().catch(error => {
          finish(error)
          void worker.terminate()
        })
      })
      worker.once("error", finish)
      worker.once("exit", code => finish(this.stopped ? undefined : new Error(`Automation cleanup Worker exited before completion (${code})`)))
    })
  }
}
