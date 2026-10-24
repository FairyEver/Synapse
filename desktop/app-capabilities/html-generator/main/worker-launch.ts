import { existsSync } from "node:fs"
import path from "node:path"
import { Worker, type WorkerOptions } from "node:worker_threads"
import type { HtmlGenerationWorkerInput } from "./worker-protocol"

export type HtmlGenerationWorkerFactory = (filename: string, options: WorkerOptions) => Worker

const DEFAULT_WORKER_FACTORY: HtmlGenerationWorkerFactory = (filename, options) => new Worker(filename, options)

export function launchHtmlGenerationWorker(input: {
  readonly baseDir: string
  readonly workerData: HtmlGenerationWorkerInput
  readonly maxOldGenerationSizeMb: number
  readonly workerFactory?: HtmlGenerationWorkerFactory
}): Worker {
  return (input.workerFactory ?? DEFAULT_WORKER_FACTORY)(resolveHtmlGenerationWorkerPath(input.baseDir), {
    workerData: input.workerData,
    resourceLimits: { maxOldGenerationSizeMb: input.maxOldGenerationSizeMb },
    stdout: true,
    stderr: true,
  })
}

export function resolveHtmlGenerationWorkerPath(baseDir: string): string {
  const workerBaseDir = baseDir.replace(/([\\/])app\.asar(?=[\\/])/, "$1app.asar.unpacked")
  const compiledPath = path.join(workerBaseDir, "worker.js")
  return workerBaseDir !== baseDir || existsSync(compiledPath)
    ? compiledPath
    : path.join(baseDir, "worker.ts")
}
