import path from "node:path"
import { Worker } from "node:worker_threads"
import type { UsageRefreshInput, UsageRefreshResult } from "./types"

export interface UsageRefreshWorkerInput {
  readonly dbPath: string
  readonly prefix: "cc" | "cx"
  readonly roots: readonly string[]
  readonly scope?: UsageRefreshInput
}

type UsageRefreshWorkerMessage =
  | { readonly type: "success"; readonly result: UsageRefreshResult }
  | { readonly type: "error"; readonly error: { readonly name?: string; readonly message?: string; readonly stack?: string } }

type UsageRefreshRunner = (input: UsageRefreshWorkerInput) => Promise<UsageRefreshResult>

const inFlightRefreshes = new Map<string, Promise<UsageRefreshResult>>()

export function refreshUsageInWorker(input: UsageRefreshWorkerInput): Promise<UsageRefreshResult> {
  return runSingleFlightUsageRefresh(input, startUsageRefreshWorker)
}

export function runSingleFlightUsageRefresh(input: UsageRefreshWorkerInput, runner: UsageRefreshRunner): Promise<UsageRefreshResult> {
  const fullKey = usageRefreshSingleFlightKey({ ...input, scope: undefined })
  const scopedKey = usageRefreshSingleFlightKey(input)
  const existingFull = inFlightRefreshes.get(fullKey)
  if (existingFull) return existingFull
  const existingScoped = inFlightRefreshes.get(scopedKey)
  if (existingScoped) return existingScoped

  const promise = runner(input).finally(() => {
    if (inFlightRefreshes.get(scopedKey) === promise) {
      inFlightRefreshes.delete(scopedKey)
    }
  })
  inFlightRefreshes.set(scopedKey, promise)
  return promise
}

export function resetUsageRefreshSingleFlightForTests(): void {
  inFlightRefreshes.clear()
}

function startUsageRefreshWorker(input: UsageRefreshWorkerInput): Promise<UsageRefreshResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(resolveUsageRefreshWorkerPath(__dirname), {
      workerData: {
        dbPath: input.dbPath,
        prefix: input.prefix,
        roots: [...input.roots],
        scope: input.scope,
      } satisfies UsageRefreshWorkerInput,
    })
    let settled = false

    worker.once("message", (message: UsageRefreshWorkerMessage) => {
      settled = true
      if (message.type === "success") {
        resolve(message.result)
        return
      }
      reject(toRefreshWorkerError(message.error))
    })
    worker.once("error", (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    worker.once("exit", (code) => {
      if (settled || code === 0) return
      settled = true
      reject(new Error(`Usage analysis refresh worker exited with code ${code}`))
    })
  })
}

function usageRefreshSingleFlightKey(input: UsageRefreshWorkerInput): string {
  return `${input.dbPath}\0${input.prefix}\0${input.scope?.preset ?? "all"}`
}

export function resolveUsageRefreshWorkerPath(baseDir: string): string {
  const workerBaseDir = baseDir.replace(/([\\/])app\.asar(?=[\\/])/, "$1app.asar.unpacked")
  return path.join(workerBaseDir, "refresh-worker.js")
}

function toRefreshWorkerError(error: { readonly name?: string; readonly message?: string; readonly stack?: string }): Error {
  const next = new Error(error.message || "Usage analysis refresh failed")
  next.name = error.name || "UsageAnalysisRefreshError"
  if (error.stack) next.stack = error.stack
  return next
}
