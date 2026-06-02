import path from "node:path"
import { Worker } from "node:worker_threads"

import type {
  ToolsFileConversionPayload,
  ToolsFileConversionResult,
  ToolsFileConversionWorkerMessage,
} from "./file-conversion-types"

type WorkerFactory = (workerPath: string, workerData: ToolsFileConversionPayload) => Worker
const DEFAULT_TIMEOUT_MS = 300_000

export function convertFilesInWorker(
  payload: ToolsFileConversionPayload,
  options: { readonly workerFactory?: WorkerFactory; readonly timeoutMs?: number } = {},
): Promise<ToolsFileConversionResult> {
  return new Promise((resolve, reject) => {
    const workerFactory = options.workerFactory ?? ((workerPath, workerData) => new Worker(workerPath, { workerData }))
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const worker = workerFactory(resolveFileConversionWorkerPath(__dirname), {
      filePaths: [...payload.filePaths],
      outputDirectory: payload.outputDirectory,
    })
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      void worker.terminate().catch(() => undefined)
      reject(new Error(`File conversion timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    worker.once("message", (message: ToolsFileConversionWorkerMessage) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (message.type === "success") {
        resolve(message.result)
        return
      }
      reject(toFileConversionWorkerError(message.error))
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
      reject(new Error(`File conversion worker exited with code ${code}`))
    })
  })
}

export function resolveFileConversionWorkerPath(baseDir: string): string {
  const workerBaseDir = baseDir.replace(/([\\/])app\.asar(?=[\\/])/, "$1app.asar.unpacked")
  return path.join(workerBaseDir, "../../workers/file-conversion-worker.js")
}

function toFileConversionWorkerError(error: { readonly name?: string; readonly message?: string; readonly stack?: string }): Error {
  const next = new Error(error.message || "File conversion failed")
  next.name = error.name || "FileConversionWorkerError"
  if (error.stack) next.stack = error.stack
  return next
}
