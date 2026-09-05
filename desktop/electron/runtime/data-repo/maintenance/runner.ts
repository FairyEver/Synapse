import path from "node:path"
import { Worker } from "node:worker_threads"

import type {
  DataMaintenanceExecution,
  DataMaintenanceExecutor,
  DataMaintenancePolicy,
  DataMaintenanceProgress,
  DataMaintenanceResult,
} from "../types"

interface CreateDataMaintenanceExecutorOptions {
  readonly databasePath: string
  readonly workerBaseDir?: string
  readonly workerFactory?: typeof Worker
}

type WorkerMessage =
  | { readonly type: "progress"; readonly progress: DataMaintenanceProgress }
  | { readonly type: "success"; readonly result: DataMaintenanceResult }
  | { readonly type: "error"; readonly error: { readonly name?: string; readonly message?: string; readonly stack?: string } }

export function createDataMaintenanceExecutor(
  options: CreateDataMaintenanceExecutorOptions,
): DataMaintenanceExecutor {
  return {
    run(policy, onProgress) {
      return startWorker({
        databasePath: options.databasePath,
        policy,
        onProgress,
        workerBaseDir: options.workerBaseDir ?? __dirname,
        WorkerConstructor: options.workerFactory ?? Worker,
      })
    },
  }
}

function startWorker(options: {
  readonly databasePath: string
  readonly policy: DataMaintenancePolicy
  readonly onProgress?: (progress: DataMaintenanceProgress) => void
  readonly workerBaseDir: string
  readonly WorkerConstructor: typeof Worker
}): DataMaintenanceExecution {
  const worker = new options.WorkerConstructor(resolveDataMaintenanceWorkerPath(options.workerBaseDir), {
    workerData: {
      databasePath: options.databasePath,
      policy: options.policy,
    },
    resourceLimits: { maxOldGenerationSizeMb: 128 },
  })
  let settled = false
  const result = new Promise<DataMaintenanceResult>((resolve, reject) => {
    worker.on("message", (message: WorkerMessage) => {
      if (message.type === "progress") {
        options.onProgress?.(message.progress)
        return
      }
      if (settled) return
      settled = true
      if (message.type === "success") {
        resolve(message.result)
        return
      }
      reject(toWorkerError(message.error))
    })
    worker.once("error", (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    worker.once("exit", (code) => {
      if (settled || code === 0) return
      settled = true
      reject(new Error(`Data maintenance worker exited with code ${code}`))
    })
  })

  return {
    result,
    terminate: () => worker.terminate(),
  }
}

export function resolveDataMaintenanceWorkerPath(baseDir: string): string {
  const workerBaseDir = baseDir.replace(/([\\/])app\.asar(?=[\\/])/, "$1app.asar.unpacked")
  return path.join(workerBaseDir, "worker.js")
}

function toWorkerError(error: { readonly name?: string; readonly message?: string; readonly stack?: string }): Error {
  const next = new Error(error.message || "Data maintenance failed")
  next.name = error.name || "DataMaintenanceError"
  if (error.stack) next.stack = error.stack
  return next
}
