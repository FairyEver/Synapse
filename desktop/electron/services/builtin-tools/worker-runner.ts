import path from "node:path"
import { Worker } from "node:worker_threads"

import { BuiltinToolError } from "./errors"

type WorkerFactory = (workerPath: string, workerData: { readonly toolId: string; readonly input: unknown }) => Worker
const DEFAULT_TIMEOUT_MS = 300_000

export function executeBuiltinToolInWorker(
  payload: { readonly toolId: string; readonly input: unknown; readonly abortSignal?: AbortSignal },
  options: { readonly workerFactory?: WorkerFactory; readonly timeoutMs?: number } = {},
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (payload.abortSignal?.aborted) {
      reject(new BuiltinToolError("cancelled", "Builtin tool run was cancelled."))
      return
    }
    const workerFactory = options.workerFactory ?? ((workerPath, workerData) => new Worker(workerPath, { workerData }))
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const worker = workerFactory(resolveBuiltinToolWorkerPath(__dirname), {
      toolId: payload.toolId,
      input: payload.input,
    })
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    const cleanup = () => {
      clearTimeout(timer)
      payload.abortSignal?.removeEventListener("abort", onAbort)
    }
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      void worker.terminate().catch(() => undefined)
      reject(new BuiltinToolError("cancelled", "Builtin tool run was cancelled."))
    }
    timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      void worker.terminate().catch(() => undefined)
      reject(new BuiltinToolError("timeout", `Builtin tool timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    payload.abortSignal?.addEventListener("abort", onAbort, { once: true })
    if (payload.abortSignal?.aborted) {
      onAbort()
      return
    }

    worker.once("message", (message: { readonly type?: string; readonly output?: unknown; readonly error?: { readonly code?: string; readonly message?: string } }) => {
      if (settled) return
      settled = true
      cleanup()
      if (message.type === "success") {
        resolve(message.output)
        return
      }
      reject(new BuiltinToolError("worker_failed", message.error?.message || "Builtin tool worker failed."))
    })

    worker.once("error", (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })

    worker.once("exit", (code) => {
      if (settled || code === 0) return
      settled = true
      cleanup()
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
