import { randomUUID } from "node:crypto"
import { constants, type BigIntStats } from "node:fs"
import { link, lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises"
import path from "node:path"

import type { ActorIdentity, AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import type { DispatchContext } from "../../../synapse-capabilities/shared/types"
import {
  TextFileWriteError,
  isTextFileWriteError,
  normalizeTextFileWriteError,
} from "../shared/errors"
import {
  TEXT_FILE_ENCODINGS,
  TEXT_FILE_FORMATS,
  textFileWriteInputSchema,
  type TextFileFormat,
  type ParsedTextFileWriteInput,
  type TextFileWriteInput,
  type TextFileWriteResult,
  isHtmlPath,
} from "../shared/schema"

const WRITE_CHUNK_BYTES = 1024 * 1024
const WRITE_ACTION = "fs.write.outside-userdata" as const

type TextFileWriterLogger = {
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
}

export type TextFileWriteContext = {
  readonly actor?: ActorIdentity
  readonly source?: DispatchContext["source"] | "app.ui" | "text-extractor"
  readonly metadata?: Record<string, unknown>
  readonly abortSignal?: AbortSignal
}

type TargetState = {
  readonly dev: bigint
  readonly ino: bigint
  readonly mode: number
  readonly size: bigint
  readonly mtimeNs: bigint
  readonly ctimeNs: bigint
}

export class TextFileWriterService {
  private readonly targetQueues = new Map<string, Promise<void>>()

  constructor(private readonly deps: {
    readonly permissionGuard: PermissionGuard
    readonly auditSink: AuditSink
    readonly logger?: TextFileWriterLogger
  }) {}

  async write(input: TextFileWriteInput, context: TextFileWriteContext = {}): Promise<TextFileWriteResult> {
    const parsed = parseInput(input)
    const format = textFileFormatFromPath(parsed.path)
    if (!format) throw new TextFileWriteError("UNSUPPORTED_EXTENSION")
    if (isHtmlPath(parsed.path) && parsed.encoding !== "utf8") {
      throw new TextFileWriteError("INVALID_ENCODING", { message: "HTML 文件仅支持 UTF-8 编码。" })
    }

    const requestedPath = normalizeRequestedPath(parsed.path)
    const initialActualPath = await resolveActualTarget(requestedPath)
    const initialQueueKey = targetQueueKey(initialActualPath)

    return this.withTargetQueue(initialQueueKey, context.abortSignal, async () => {
      assertNotAborted(context.abortSignal)
      const actualPath = await resolveActualTarget(requestedPath)
      if (targetQueueKey(actualPath) !== initialQueueKey) {
        throw new TextFileWriteError("TARGET_CHANGED")
      }

      const actor = context.actor ?? { kind: "user", id: "text-file-writer" }
      const metadata = {
        ...safeContextMetadata(context.metadata),
        source: context.source ?? "app.ui",
        capabilityAction: "app.text_file_writer.file.write",
        format,
        encoding: parsed.encoding,
        textLength: parsed.text.length,
      }
      let authorized = false
      try {
        await this.authorize(actor, actualPath, metadata)
        authorized = true
        const result = await writeTextFile(actualPath, parsed, format, context.abortSignal, this.deps.logger)
        this.deps.auditSink.record({
          action: WRITE_ACTION,
          actor,
          resource: actualPath,
          outcome: "allowed",
          metadata: { ...metadata, size: result.size, overwritten: result.overwritten },
        })
        this.deps.logger?.info("text file write succeeded", {
          format,
          encoding: result.encoding,
          size: result.size,
          overwritten: result.overwritten,
          pathLength: actualPath.length,
        })
        return result
      } catch (error) {
        const normalized = normalizeTextFileWriteError(error)
        if (authorized) {
          this.deps.auditSink.record({
            action: WRITE_ACTION,
            actor,
            resource: actualPath,
            outcome: "failed",
            metadata: { ...metadata, errorCode: normalized.code },
          })
        }
        this.deps.logger?.warn("text file write failed", {
          errorCode: normalized.code,
          format,
          encoding: parsed.encoding,
          textLength: parsed.text.length,
          pathLength: actualPath.length,
        })
        throw normalized
      }
    })
  }

  private async authorize(
    actor: ActorIdentity,
    resource: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const permission = await this.deps.permissionGuard.check({
      action: WRITE_ACTION,
      actor,
      resource,
      context: metadata,
    })
    if (permission.allowed) return
    this.deps.auditSink.record({
      action: WRITE_ACTION,
      actor,
      resource,
      outcome: "denied",
      metadata: { ...metadata, policyId: permission.policyId },
    })
    throw new TextFileWriteError("PERMISSION_DENIED")
  }

  private async withTargetQueue<T>(
    key: string,
    signal: AbortSignal | undefined,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.targetQueues.get(key) ?? Promise.resolve()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => undefined).then(() => gate)
    this.targetQueues.set(key, tail)

    try {
      await waitForTurn(previous, signal)
      return await task()
    } finally {
      release()
      if (this.targetQueues.get(key) === tail) {
        this.targetQueues.delete(key)
      }
    }
  }
}

function parseInput(input: TextFileWriteInput): ParsedTextFileWriteInput {
  const parsed = textFileWriteInputSchema.safeParse(input)
  if (parsed.success) return parsed.data
  const raw = input as Record<string, unknown>
  if (typeof raw.path !== "string" || !path.isAbsolute(raw.path) || raw.path.includes("\0")) {
    throw new TextFileWriteError("INVALID_PATH")
  }
  if (raw.encoding !== undefined && !TEXT_FILE_ENCODINGS.includes(raw.encoding as never)) {
    throw new TextFileWriteError("INVALID_ENCODING")
  }
  if (typeof raw.path === "string" && isHtmlPath(raw.path) && raw.encoding === "utf16le") {
    throw new TextFileWriteError("INVALID_ENCODING", { message: "HTML 文件仅支持 UTF-8 编码。" })
  }
  throw new TextFileWriteError("WRITE_FAILED")
}

function normalizeRequestedPath(value: string): string {
  if (!path.isAbsolute(value) || value.includes("\0") || value.startsWith("file://")) {
    throw new TextFileWriteError("INVALID_PATH")
  }
  return path.normalize(value)
}

function textFileFormatFromPath(filePath: string): TextFileFormat | null {
  const extension = path.extname(filePath).slice(1).toLowerCase()
  return TEXT_FILE_FORMATS.find((format) => format === extension) ?? null
}

async function resolveActualTarget(requestedPath: string): Promise<string> {
  const requestedParent = path.dirname(requestedPath)
  const actualParent = await resolveActualDirectory(requestedParent)
  return path.join(actualParent, path.basename(requestedPath))
}

async function resolveActualDirectory(requestedDirectory: string): Promise<string> {
  let cursor = requestedDirectory
  const missingSegments: string[] = []
  while (true) {
    try {
      await lstat(cursor)
      break
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) throw error
      const parent = path.dirname(cursor)
      if (parent === cursor) throw new TextFileWriteError("INVALID_PATH")
      missingSegments.unshift(path.basename(cursor))
      cursor = parent
    }
  }

  const actualAncestor = await realpath(cursor)
  const ancestorState = await lstat(actualAncestor)
  if (!ancestorState.isDirectory()) throw new TextFileWriteError("UNSAFE_TARGET")
  return path.join(actualAncestor, ...missingSegments)
}

async function writeTextFile(
  actualPath: string,
  input: ParsedTextFileWriteInput,
  format: NonNullable<ReturnType<typeof textFileFormatFromPath>>,
  signal: AbortSignal | undefined,
  logger: TextFileWriterLogger | undefined,
): Promise<TextFileWriteResult> {
  const actualParent = path.dirname(actualPath)
  await mkdir(actualParent, { recursive: true })
  const verifiedParent = await realpath(actualParent)
  if (targetQueueKey(verifiedParent) !== targetQueueKey(actualParent)) {
    throw new TextFileWriteError("TARGET_CHANGED")
  }
  assertNotAborted(signal)

  const initialTarget = await inspectTarget(actualPath)
  if (initialTarget && !input.overwrite) throw new TextFileWriteError("TARGET_EXISTS")

  const bytes = Buffer.from(input.text, input.encoding)
  const temporaryPath = path.join(
    actualParent,
    `.synapse-text-file-writer-${path.basename(actualPath)}-${process.pid}-${randomUUID()}.tmp`,
  )
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
  const mode = initialTarget?.mode ?? 0o666
  let handle: Awaited<ReturnType<typeof open>> | null = null
  let committed = false

  try {
    handle = await open(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      mode,
    )
    await writeBuffer(handle, bytes, signal)
    if (initialTarget) await handle.chmod(initialTarget.mode)
    await handle.sync()
    await handle.close()
    handle = null
    assertNotAborted(signal)

    if (initialTarget) {
      await assertTargetUnchanged(actualPath, initialTarget)
      await rename(temporaryPath, actualPath)
      committed = true
    } else {
      const currentTarget = await inspectTarget(actualPath)
      if (currentTarget) {
        throw new TextFileWriteError(input.overwrite ? "TARGET_CHANGED" : "TARGET_EXISTS")
      }
      try {
        await link(temporaryPath, actualPath)
      } catch (error) {
        if (hasErrorCode(error, "EEXIST")) {
          throw new TextFileWriteError(input.overwrite ? "TARGET_CHANGED" : "TARGET_EXISTS", { cause: error })
        }
        throw error
      }
      committed = true
      await rm(temporaryPath, { force: true }).catch((error) => {
        logger?.warn("text file writer committed temporary cleanup failed", {
          errorCategory: errorCategory(error),
        })
      })
    }
  } catch (error) {
    if (handle) {
      await handle.close().catch((cleanupError) => {
        logger?.warn("text file writer handle cleanup failed", {
          errorCategory: errorCategory(cleanupError),
        })
      })
    }
    if (!committed) {
      await rm(temporaryPath, { force: true }).catch((cleanupError) => {
        logger?.warn("text file writer temporary cleanup failed", {
          errorCategory: errorCategory(cleanupError),
        })
      })
    }
    if (isTextFileWriteError(error)) throw error
    throw new TextFileWriteError("WRITE_FAILED", { cause: error })
  }

  return {
    path: actualPath,
    fileName: path.basename(actualPath),
    format,
    encoding: input.encoding,
    size: bytes.byteLength,
    overwritten: initialTarget !== null,
  }
}

async function writeBuffer(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Buffer,
  signal: AbortSignal | undefined,
): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    assertNotAborted(signal)
    const length = Math.min(WRITE_CHUNK_BYTES, bytes.byteLength - offset)
    const result = await handle.write(bytes, offset, length, offset)
    if (result.bytesWritten <= 0) throw new TextFileWriteError("WRITE_FAILED")
    offset += result.bytesWritten
  }
}

async function inspectTarget(filePath: string): Promise<TargetState | null> {
  let state: BigIntStats
  try {
    state = await lstat(filePath, { bigint: true })
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null
    throw error
  }
  if (state.isSymbolicLink() || !state.isFile()) {
    throw new TextFileWriteError("UNSAFE_TARGET")
  }
  return {
    dev: state.dev,
    ino: state.ino,
    mode: Number(state.mode & 0o7777n),
    size: state.size,
    mtimeNs: state.mtimeNs,
    ctimeNs: state.ctimeNs,
  }
}

async function assertTargetUnchanged(filePath: string, initial: TargetState): Promise<void> {
  const current = await inspectTarget(filePath)
  if (!current || !sameTargetState(initial, current)) {
    throw new TextFileWriteError("TARGET_CHANGED")
  }
}

function sameTargetState(left: TargetState, right: TargetState): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
}

function targetQueueKey(value: string): string {
  const normalized = path.normalize(value)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new TextFileWriteError("ABORTED")
}

async function waitForTurn(promise: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
  if (!signal) return promise
  assertNotAborted(signal)
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(new TextFileWriteError("ABORTED"))
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort))
  })
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code
}

function errorCategory(error: unknown): string {
  if (typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code
  }
  return error instanceof Error ? error.name : "UNKNOWN"
}

function safeContextMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {}
  return Object.fromEntries(Object.entries(metadata).filter(([key, value]) => {
    if (/(text|content|body|path|error|exception|message)/i.test(key)) return false
    return value === null || ["string", "number", "boolean"].includes(typeof value)
  }))
}
