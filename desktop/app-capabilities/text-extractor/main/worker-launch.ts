import { existsSync } from "node:fs"
import path from "node:path"
import { Worker, type WorkerOptions } from "node:worker_threads"
import type { TextExtractionWorkerInput } from "./worker-protocol"

export type TextExtractionWorkerFactory = (
  filename: string,
  options: WorkerOptions,
) => Worker

export type TextExtractionWorkerLaunch = {
  readonly baseDir: string
  readonly bytes: Buffer
  readonly format: TextExtractionWorkerInput["format"]
  readonly maxPages: number
  readonly maxTextBytes: number
  readonly maxOldGenerationSizeMb: number
  readonly workerFactory?: TextExtractionWorkerFactory
}

const DEFAULT_WORKER_FACTORY: TextExtractionWorkerFactory = (filename, options) => (
  new Worker(filename, options)
)

export function launchTextExtractionWorker(
  input: TextExtractionWorkerLaunch,
): Worker {
  const transferable = input.bytes.buffer.slice(
    input.bytes.byteOffset,
    input.bytes.byteOffset + input.bytes.byteLength,
  ) as ArrayBuffer
  return (input.workerFactory ?? DEFAULT_WORKER_FACTORY)(
    resolveTextExtractionWorkerPath(input.baseDir),
    {
      workerData: {
        bytes: transferable,
        format: input.format,
        maxPages: input.maxPages,
        maxTextBytes: input.maxTextBytes,
      } satisfies TextExtractionWorkerInput,
      transferList: [transferable],
      resourceLimits: {
        maxOldGenerationSizeMb: input.maxOldGenerationSizeMb,
      },
    },
  )
}

export function resolveTextExtractionWorkerPath(baseDir: string): string {
  const workerBaseDir = baseDir.replace(/([\\/])app\.asar(?=[\\/])/, "$1app.asar.unpacked")
  const compiledPath = path.join(workerBaseDir, "worker.js")
  return workerBaseDir !== baseDir || existsSync(compiledPath)
    ? compiledPath
    : path.join(baseDir, "worker.ts")
}
