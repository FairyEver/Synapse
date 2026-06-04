import path from "node:path"
import { Worker } from "node:worker_threads"

import { BuiltinToolError } from "./errors"

type WorkerFactory = (workerPath: string, workerData: { readonly toolId: string; readonly input: unknown }) => Worker
const DEFAULT_TIMEOUT_MS = 300_000

export function executeBuiltinToolInWorker(
  payload: { readonly toolId: string; readonly input: unknown },
  options: { readonly workerFactory?: WorkerFactory; readonly timeoutMs?: number } = {},
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const workerFactory = options.workerFactory ?? ((workerPath, workerData) => new Worker(workerPath, { workerData }))
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const worker = workerFactory(resolveBuiltinToolWorkerPath(__dirname), payload)
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      void worker.terminate().catch(() => undefined)
      reject(new BuiltinToolError("timeout", `Builtin tool timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    worker.once("message", (message: { readonly type?: string; readonly output?: unknown; readonly error?: { readonly code?: string; readonly message?: string } }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (message.type === "success") {
        resolve(message.output)
        return
      }
      reject(new BuiltinToolError("worker_failed", message.error?.message || "Builtin tool worker failed."))
    })

    worker.once("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })

    worker.once("exit", (code) => {
      if (settled || code === 0) return
      settled = true
      clearTimeout(timer)
      reject(new BuiltinToolError("worker_failed", `Builtin tool worker exited with code ${code}`))
    })
  })
}

export function resolveBuiltinToolWorkerPath(baseDir: string): string {
  if (baseDir.includes("app.asar")) {
    const workerBaseDir = baseDir.replace(/([\\/])app\.asar(?=[\\/])/, "$1app.asar.unpacked")
    return path.join(workerBaseDir, "../../worker-bootstraps/builtin-tool-worker-bootstrap.js")
  }
  return path.join(baseDir, "../../workers/builtin-tool-worker.js")
}
