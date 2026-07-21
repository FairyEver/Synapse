import { constants } from "node:fs"
import { existsSync } from "node:fs"
import { lstat, open } from "node:fs/promises"
import path from "node:path"
import { Worker } from "node:worker_threads"
import type { DispatchContext } from "../../../synapse-capabilities/shared/types"
import {
  DOCUMENT_TEXT_EXTRACTION_MAX_FILE_BYTES,
  DOCUMENT_TEXT_EXTRACTION_MAX_PDF_PAGES,
  DOCUMENT_TEXT_EXTRACTION_MAX_TEXT_BYTES,
  DOCUMENT_TEXT_EXTRACTION_TIMEOUT_MS,
  DOCUMENT_TEXT_EXTRACTION_WORKER_MAX_OLD_GENERATION_MB,
} from "../../../config"
import type { StructuredLogger } from "../../../electron/runtime/service-registry"
import type {
  ActorIdentity,
  AuditSink,
  PermissionGuard,
} from "../../../electron/runtime/security"
import { DOCUMENT_TEXT_EXTRACTOR_CAPABILITY_ID } from "../shared/capability"
import {
  DocumentTextExtractionError,
  type DocumentTextExtractionErrorCode,
} from "../shared/errors"
import {
  documentTextExtractionInputSchema,
  type DocumentTextExtractionInput,
  type DocumentTextExtractionResult,
} from "../shared/schema"
import type {
  DocumentTextExtractionWorkerInput,
  DocumentTextExtractionWorkerMessage,
} from "./worker-protocol"

export type DocumentTextExtractorService = {
  extract(
    input: DocumentTextExtractionInput,
    context?: DispatchContext,
  ): Promise<DocumentTextExtractionResult>
}

type ServiceLogger = Pick<StructuredLogger, "info" | "warn">

const DEFAULT_ACTOR: ActorIdentity = {
  kind: "user",
  id: "synapse-document-text-extractor",
  display: "Synapse Document Text Extractor",
}

export function createDocumentTextExtractorService(deps: {
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly logger?: ServiceLogger
  readonly actor?: ActorIdentity
}): DocumentTextExtractorService {
  return {
    async extract(input, context = {}) {
      const startedAt = Date.now()
      const parsed = documentTextExtractionInputSchema.parse(input)
      if (path.extname(parsed.filePath).toLowerCase() !== ".pdf") {
        throw new DocumentTextExtractionError("UNSUPPORTED_FORMAT")
      }
      await authorizeDocumentRead(deps, context, parsed.filePath)

      try {
        const file = await readVerifiedFile(parsed.filePath)
        if (!hasPdfHeader(file.bytes)) {
          throw new DocumentTextExtractionError("INVALID_DOCUMENT")
        }
        const extracted = await extractPdfInWorker(file.bytes)
        const result: DocumentTextExtractionResult = {
          text: extracted.text,
          format: "pdf",
          fileName: path.basename(parsed.filePath),
          size: file.size,
          pages: extracted.pages,
        }
        deps.logger?.info("Document text extraction completed.", {
          format: result.format,
          sourceBytes: result.size,
          textBytes: Buffer.byteLength(result.text, "utf8"),
          pages: result.pages,
          durationMs: Date.now() - startedAt,
        })
        return result
      } catch (error) {
        const normalized = normalizeServiceError(error)
        deps.logger?.warn("Document text extraction failed.", {
          errorCode: normalized.code,
          durationMs: Date.now() - startedAt,
        })
        throw normalized
      }
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
    capabilityAction: DOCUMENT_TEXT_EXTRACTOR_CAPABILITY_ID,
    boundary: "documentTextExtractor.service.document",
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
  if (!permission.allowed) throw new Error(permission.reason)
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
    throw new DocumentTextExtractionError("READ_FAILED", { cause: error })
  }
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new DocumentTextExtractionError("READ_FAILED")
  }
  if (before.size > BigInt(DOCUMENT_TEXT_EXTRACTION_MAX_FILE_BYTES)) {
    throw new DocumentTextExtractionError("FILE_TOO_LARGE")
  }

  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
  let handle
  try {
    handle = await open(filePath, constants.O_RDONLY | noFollow)
  } catch (error) {
    throw new DocumentTextExtractionError("READ_FAILED", { cause: error })
  }

  try {
    const opened = await handle.stat({ bigint: true })
    assertSameFile(before, opened)
    if (!opened.isFile()) throw new DocumentTextExtractionError("READ_FAILED")
    if (opened.size > BigInt(DOCUMENT_TEXT_EXTRACTION_MAX_FILE_BYTES)) {
      throw new DocumentTextExtractionError("FILE_TOO_LARGE")
    }

    const bytes = await handle.readFile()
    const [afterOpened, afterPath] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(filePath, { bigint: true }),
    ])
    assertSameFile(opened, afterOpened)
    assertSameFile(afterOpened, afterPath)
    if (afterPath.isSymbolicLink() || !afterPath.isFile()) {
      throw new DocumentTextExtractionError("READ_FAILED")
    }
    if (BigInt(bytes.byteLength) !== afterOpened.size) {
      throw new DocumentTextExtractionError("READ_FAILED")
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
  if (failure instanceof DocumentTextExtractionError) throw failure
  if (failure) throw new DocumentTextExtractionError("READ_FAILED", { cause: failure })
  if (!result) throw new DocumentTextExtractionError("READ_FAILED")
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
    throw new DocumentTextExtractionError("READ_FAILED")
  }
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 8) return false
  const header = Buffer.from(bytes.subarray(0, 8)).toString("ascii")
  return /^%PDF-(?:1\.[0-7]|2\.0)$/.test(header)
}

function extractPdfInWorker(
  bytes: Buffer,
): Promise<{ readonly text: string; readonly pages: number }> {
  const transferable = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  return new Promise((resolve, reject) => {
    const worker = new Worker(resolveDocumentTextExtractionWorkerPath(__dirname), {
      workerData: {
        bytes: transferable,
        maxPages: DOCUMENT_TEXT_EXTRACTION_MAX_PDF_PAGES,
        maxTextBytes: DOCUMENT_TEXT_EXTRACTION_MAX_TEXT_BYTES,
      } satisfies DocumentTextExtractionWorkerInput,
      transferList: [transferable],
      resourceLimits: {
        maxOldGenerationSizeMb: DOCUMENT_TEXT_EXTRACTION_WORKER_MAX_OLD_GENERATION_MB,
      },
    })
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      void worker.terminate()
      reject(new DocumentTextExtractionError("EXTRACTION_TIMEOUT"))
    }, DOCUMENT_TEXT_EXTRACTION_TIMEOUT_MS)

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      void worker.terminate()
      callback()
    }

    worker.once("message", (message: DocumentTextExtractionWorkerMessage) => {
      finish(() => {
        if (message.type === "success") {
          resolve(message.result)
          return
        }
        reject(new DocumentTextExtractionError(message.code))
      })
    })
    worker.once("error", (error) => {
      finish(() => reject(new DocumentTextExtractionError(
        isWorkerMemoryError(error) ? "EXTRACTION_MEMORY_LIMIT" : "EXTRACTION_FAILED",
        { cause: error },
      )))
    })
    worker.once("exit", (code) => {
      if (settled) return
      finish(() => reject(new DocumentTextExtractionError(
        "EXTRACTION_FAILED",
        code === 0 ? undefined : { cause: new Error(`Worker exited with code ${code}`) },
      )))
    })
  })
}

export function resolveDocumentTextExtractionWorkerPath(baseDir: string): string {
  const workerBaseDir = baseDir.replace(/([\\/])app\.asar(?=[\\/])/, "$1app.asar.unpacked")
  const compiledPath = path.join(workerBaseDir, "worker.js")
  return workerBaseDir !== baseDir || existsSync(compiledPath)
    ? compiledPath
    : path.join(baseDir, "worker.ts")
}

function isWorkerMemoryError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "ERR_WORKER_OUT_OF_MEMORY"
}

function normalizeServiceError(error: unknown): DocumentTextExtractionError {
  return error instanceof DocumentTextExtractionError
    ? error
    : new DocumentTextExtractionError("EXTRACTION_FAILED", { cause: error })
}

export function serializeDocumentTextExtractionError(error: unknown): {
  readonly code: DocumentTextExtractionErrorCode
  readonly message: string
} {
  const normalized = normalizeServiceError(error)
  return { code: normalized.code, message: normalized.message }
}
