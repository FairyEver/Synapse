import { existsSync } from "node:fs"
import path from "node:path"
import { Worker, type WorkerOptions } from "node:worker_threads"
import type { DocumentTextExtractionWorkerInput } from "./worker-protocol"

export type DocumentTextExtractionWorkerFactory = (
  filename: string,
  options: WorkerOptions,
) => Worker

export type DocumentTextExtractionWorkerLaunch = {
  readonly baseDir: string
  readonly bytes: Buffer
  readonly format: DocumentTextExtractionWorkerInput["format"]
  readonly maxPages: number
  readonly maxTextBytes: number
  readonly maxOldGenerationSizeMb: number
  readonly workerFactory?: DocumentTextExtractionWorkerFactory
}

const DEFAULT_WORKER_FACTORY: DocumentTextExtractionWorkerFactory = (filename, options) => (
  new Worker(filename, options)
)

export function launchDocumentTextExtractionWorker(
  input: DocumentTextExtractionWorkerLaunch,
): Worker {
  const transferable = input.bytes.buffer.slice(
    input.bytes.byteOffset,
    input.bytes.byteOffset + input.bytes.byteLength,
  ) as ArrayBuffer
  return (input.workerFactory ?? DEFAULT_WORKER_FACTORY)(
    resolveDocumentTextExtractionWorkerPath(input.baseDir),
    {
      workerData: {
        bytes: transferable,
        format: input.format,
        maxPages: input.maxPages,
        maxTextBytes: input.maxTextBytes,
      } satisfies DocumentTextExtractionWorkerInput,
      transferList: [transferable],
      resourceLimits: {
        maxOldGenerationSizeMb: input.maxOldGenerationSizeMb,
      },
    },
  )
}

export function resolveDocumentTextExtractionWorkerPath(baseDir: string): string {
  const workerBaseDir = baseDir.replace(/([\\/])app\.asar(?=[\\/])/, "$1app.asar.unpacked")
  const compiledPath = path.join(workerBaseDir, "worker.js")
  return workerBaseDir !== baseDir || existsSync(compiledPath)
    ? compiledPath
    : path.join(baseDir, "worker.ts")
}
