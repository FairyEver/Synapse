import { constants } from "node:fs"
import { lstat, open } from "node:fs/promises"
import path from "node:path"
import type { DispatchContext } from "../../../synapse-capabilities/shared/types"
import {
  TEXT_EXTRACTION_MAX_FILE_BYTES,
  TEXT_EXTRACTION_MAX_CONCURRENCY,
  TEXT_EXTRACTION_MAX_PDF_PAGES,
  TEXT_EXTRACTION_MAX_TEXT_BYTES,
  TEXT_EXTRACTION_TIMEOUT_MS,
  TEXT_EXTRACTION_WORKER_MAX_OLD_GENERATION_MB,
} from "../../../config"
import type { StructuredLogger } from "../../../electron/runtime/service-registry"
import type {
  ActorIdentity,
  AuditSink,
  PermissionGuard,
} from "../../../electron/runtime/security"
import { TEXT_EXTRACTOR_CAPABILITY_ID } from "../shared/capability"
import {
  TextExtractionError,
  type TextExtractionErrorCode,
} from "../shared/errors"
import {
  textExtractionInputSchema,
  type TextExtractionInput,
  type TextExtractionResult,
} from "../shared/schema"
import type { TextExtractionWorkerMessage } from "./worker-protocol"
import {
  launchTextExtractionWorker,
  type TextExtractionWorkerFactory,
} from "./worker-launch"
import {
  TextExtractionScheduler,
  type TextExtractionTask,
} from "./scheduler"

type DocumentFormat = TextExtractionResult["format"]

type WorkerExtractionResult = {
  readonly text: string
  readonly pages?: number
  readonly warningCount?: number
  readonly warningCategories?: readonly string[]
}

type TextExtractionWorkerRuntime = {
  run(
    bytes: Buffer,
    format: DocumentFormat,
    signal: AbortSignal,
    onStarted: () => void,
  ): Promise<WorkerExtractionResult>
}

export type { TextExtractionWorkerFactory } from "./worker-launch"
export { resolveTextExtractionWorkerPath } from "./worker-launch"

export type TextExtractorService = {
  createTask(
    input: TextExtractionInput,
    context?: DispatchContext,
  ): TextExtractionTask<TextExtractionResult>
  extract(
    input: TextExtractionInput,
    context?: DispatchContext,
  ): Promise<TextExtractionResult>
  stop(): Promise<void>
}

type ServiceLogger = Pick<StructuredLogger, "info" | "warn">

const DEFAULT_ACTOR: ActorIdentity = {
  kind: "user",
  id: "synapse-text-extractor",
  display: "Synapse Text Extractor",
}

export function createTextExtractorService(deps: {
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly logger?: ServiceLogger
  readonly actor?: ActorIdentity
  readonly workerFactory?: TextExtractionWorkerFactory
}): TextExtractorService {
  const scheduler = new TextExtractionScheduler(
    TEXT_EXTRACTION_MAX_CONCURRENCY,
    deps.logger,
  )
  const workerFactory = deps.workerFactory
  const workerRuntime: TextExtractionWorkerRuntime = {
    run: (bytes, format, signal, onStarted) => extractDocumentInWorker(
      bytes,
      format,
      signal,
      onStarted,
      workerFactory,
    ),
  }

  function createTask(
    input: TextExtractionInput,
    context: DispatchContext = {},
  ): TextExtractionTask<TextExtractionResult> {
    const parsed = textExtractionInputSchema.parse(input)
    const format = getDocumentFormat(parsed.filePath)
    if (!format) {
      throw new TextExtractionError("UNSUPPORTED_FORMAT")
    }
    return scheduler.schedule(async (signal, markRunning) => {
      const startedAt = Date.now()
      await authorizeDocumentRead(deps, context, parsed.filePath)

      try {
        const file = await readVerifiedFile(parsed.filePath)
        if (format === "pdf" && !hasPdfHeader(file.bytes)) {
          throw new TextExtractionError("INVALID_DOCUMENT")
        }
        const extracted = await runWorkerWithTimeout(
          workerRuntime,
          file.bytes,
          format,
          signal,
          markRunning,
        )
        const metadata = {
          text: extracted.text,
          fileName: path.basename(parsed.filePath),
          size: file.size,
        }
        const result: TextExtractionResult = format === "pdf"
          ? { ...metadata, format, ...(extracted.pages === undefined ? {} : { pages: extracted.pages }) }
          : { ...metadata, format }
        if (extracted.warningCount) {
          deps.logger?.warn("Text extraction completed with warnings.", {
            format,
            warningCount: extracted.warningCount,
            warningCategories: extracted.warningCategories ?? [],
          })
        }
        deps.logger?.info("Text extraction completed.", {
          format: result.format,
          sourceBytes: result.size,
          textBytes: Buffer.byteLength(result.text, "utf8"),
          ...("pages" in result && result.pages !== undefined ? { pages: result.pages } : {}),
          durationMs: Date.now() - startedAt,
        })
        return result
      } catch (error) {
        const normalized = normalizeServiceError(error)
        deps.logger?.warn("Text extraction failed.", {
          errorCode: normalized.code,
          durationMs: Date.now() - startedAt,
        })
        throw normalized
      }
    })
  }

  return {
    createTask,
    async extract(input, context = {}) {
      return createTask(input, context).result
    },
    async stop() {
      await scheduler.cancelAll()
    },
  }
}

async function authorizeDocumentRead(
  deps: {
    readonly permissionGuard: PermissionGuard
    readonly auditSink: AuditSink
    readonly actor?: ActorIdentity
  },
  context: DispatchContext,
  filePath: string,
): Promise<void> {
  const actor = context.actor ?? deps.actor ?? DEFAULT_ACTOR
  const metadata = {
    source: context.source ?? "api",
    capabilityAction: TEXT_EXTRACTOR_CAPABILITY_ID,
    boundary: "textExtractor.service.document",
    ...(context.clientId ? { clientId: context.clientId } : {}),
    ...(context.controllerInstanceId ? { controllerInstanceId: context.controllerInstanceId } : {}),
  }
  const permission = await deps.permissionGuard.check({
    action: "fs.read.outside-userdata",
    actor,
    resource: filePath,
    context: metadata,
  })
  deps.auditSink.record({
    action: "fs.read.outside-userdata",
    actor,
    resource: path.basename(filePath),
    outcome: permission.allowed ? "allowed" : "denied",
    metadata: permission.allowed
      ? metadata
      : { ...metadata, reason: permission.reason, policyId: permission.policyId },
  })
  if (!permission.allowed) throw new TextExtractionError("PERMISSION_DENIED")
}

async function readVerifiedFile(
  filePath: string,
): Promise<{ readonly bytes: Buffer; readonly size: number }> {
  let before
  let result: { readonly bytes: Buffer; readonly size: number } | undefined
  let failure: unknown
  try {
    before = await lstat(filePath, { bigint: true })
  } catch (error) {
    throw new TextExtractionError("READ_FAILED", { cause: error })
  }
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new TextExtractionError("READ_FAILED")
  }
  if (before.size > BigInt(TEXT_EXTRACTION_MAX_FILE_BYTES)) {
    throw new TextExtractionError("FILE_TOO_LARGE")
  }

  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
  let handle
  try {
    handle = await open(filePath, constants.O_RDONLY | noFollow)
  } catch (error) {
    throw new TextExtractionError("READ_FAILED", { cause: error })
  }

  try {
    const opened = await handle.stat({ bigint: true })
    assertSameFile(before, opened)
    if (!opened.isFile()) throw new TextExtractionError("READ_FAILED")
    if (opened.size > BigInt(TEXT_EXTRACTION_MAX_FILE_BYTES)) {
      throw new TextExtractionError("FILE_TOO_LARGE")
    }

    const bytes = await handle.readFile()
    const [afterOpened, afterPath] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(filePath, { bigint: true }),
    ])
    assertSameFile(opened, afterOpened)
    assertSameFile(afterOpened, afterPath)
    if (afterPath.isSymbolicLink() || !afterPath.isFile()) {
      throw new TextExtractionError("READ_FAILED")
    }
    if (BigInt(bytes.byteLength) !== afterOpened.size) {
      throw new TextExtractionError("READ_FAILED")
    }
    result = { bytes, size: bytes.byteLength }
  } catch (error) {
    failure = error
  }
  try {
    await handle.close()
  } catch (error) {
    failure ??= error
  }
  if (failure instanceof TextExtractionError) throw failure
  if (failure) throw new TextExtractionError("READ_FAILED", { cause: failure })
  if (!result) throw new TextExtractionError("READ_FAILED")
  return result
}

function assertSameFile(
  expected: { readonly dev: bigint; readonly ino: bigint; readonly size: bigint; readonly mtimeNs: bigint },
  actual: { readonly dev: bigint; readonly ino: bigint; readonly size: bigint; readonly mtimeNs: bigint },
): void {
  if (
    expected.dev !== actual.dev
    || expected.ino !== actual.ino
    || expected.size !== actual.size
    || expected.mtimeNs !== actual.mtimeNs
  ) {
    throw new TextExtractionError("READ_FAILED")
  }
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 8) return false
  const header = Buffer.from(bytes.subarray(0, 8)).toString("ascii")
  return /^%PDF-(?:1\.[0-7]|2\.0)$/.test(header)
}

function extractDocumentInWorker(
  bytes: Buffer,
  format: DocumentFormat,
  signal: AbortSignal,
  onStarted: () => void,
  workerFactory: TextExtractionWorkerFactory | undefined,
): Promise<WorkerExtractionResult> {
  if (signal.aborted) {
    return Promise.reject(new TextExtractionError("EXTRACTION_CANCELLED"))
  }
  return new Promise((resolve, reject) => {
    const worker = launchTextExtractionWorker({
      baseDir: __dirname,
      bytes,
      format,
      maxPages: TEXT_EXTRACTION_MAX_PDF_PAGES,
      maxTextBytes: TEXT_EXTRACTION_MAX_TEXT_BYTES,
      maxOldGenerationSizeMb: TEXT_EXTRACTION_WORKER_MAX_OLD_GENERATION_MB,
      workerFactory,
    })
    onStarted()
    let settled = false
    const onAbort = () => finish(
      () => reject(new TextExtractionError("EXTRACTION_CANCELLED")),
    )

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", onAbort)
      void worker.terminate().then(callback, callback)
    }

    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener("abort", onAbort, { once: true })

    worker.once("message", (message: TextExtractionWorkerMessage) => {
      finish(() => {
        if (message.type === "success") {
          resolve(message.result)
          return
        }
        reject(new TextExtractionError(message.code))
      })
    })
    worker.once("error", (error) => {
      finish(() => reject(new TextExtractionError(
        isWorkerMemoryError(error) ? "EXTRACTION_MEMORY_LIMIT" : "EXTRACTION_FAILED",
        { cause: error },
      )))
    })
    worker.once("exit", (code) => {
      if (settled) return
      finish(() => reject(new TextExtractionError(
        "EXTRACTION_FAILED",
        code === 0 ? undefined : { cause: new Error(`Worker exited with code ${code}`) },
      )))
    })
  })
}

function getDocumentFormat(filePath: string): DocumentFormat | undefined {
  switch (path.extname(filePath).toLowerCase()) {
    case ".pdf":
      return "pdf"
    case ".docx":
      return "docx"
    default:
      return undefined
  }
}

async function runWorkerWithTimeout(
  workerRuntime: TextExtractionWorkerRuntime,
  bytes: Buffer,
  format: DocumentFormat,
  signal: AbortSignal,
  onStarted: () => void,
): Promise<WorkerExtractionResult> {
  const workerController = new AbortController()
  let timedOut = false
  const abortWorker = () => workerController.abort()
  if (signal.aborted) abortWorker()
  else signal.addEventListener("abort", abortWorker, { once: true })
  let timeout: ReturnType<typeof setTimeout> | undefined

  try {
    return await workerRuntime.run(bytes, format, workerController.signal, () => {
      onStarted()
      timeout = setTimeout(() => {
        timedOut = true
        workerController.abort()
      }, TEXT_EXTRACTION_TIMEOUT_MS)
    })
  } catch (error) {
    if (timedOut) {
      throw new TextExtractionError("EXTRACTION_TIMEOUT", { cause: error })
    }
    if (signal.aborted) {
      throw new TextExtractionError("EXTRACTION_CANCELLED", { cause: error })
    }
    throw error
  } finally {
    if (timeout) clearTimeout(timeout)
    signal.removeEventListener("abort", abortWorker)
  }
}

function isWorkerMemoryError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "ERR_WORKER_OUT_OF_MEMORY"
}

function normalizeServiceError(error: unknown): TextExtractionError {
  if (error instanceof TextExtractionError) return error
  return new TextExtractionError(
    isWorkerMemoryError(error) ? "EXTRACTION_MEMORY_LIMIT" : "EXTRACTION_FAILED",
    { cause: error },
  )
}

export function serializeTextExtractionError(error: unknown): {
  readonly code: TextExtractionErrorCode
  readonly message: string
} {
  const normalized = normalizeServiceError(error)
  return { code: normalized.code, message: normalized.message }
}
