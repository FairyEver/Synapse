import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { lstat, open, rename, rm } from "node:fs/promises"
import path from "node:path"
import {
  DocumentTextSaveError,
  isDocumentTextSaveError,
} from "../shared/errors"
import {
  documentTextSaveInputSchema,
  type DocumentTextSaveInput,
  type DocumentTextSaveResult,
} from "../shared/schema"

type RenameFile = typeof rename
type OpenFile = typeof open
type RemoveFile = typeof rm

type DocumentTextSaveLogger = {
  warn?(message: string, meta?: unknown): void
}

type DocumentTextSaveServiceDeps = {
  readonly logger?: DocumentTextSaveLogger
  readonly open?: OpenFile
  readonly remove?: RemoveFile
  readonly rename?: RenameFile
}

export type DocumentTextSaveService = {
  save(input: DocumentTextSaveInput): Promise<DocumentTextSaveResult>
}

type TargetIdentity = {
  readonly dev: bigint
  readonly ino: bigint
  readonly mode: number
}

export function createDocumentTextSaveService(
  deps: DocumentTextSaveServiceDeps = {},
): DocumentTextSaveService {
  return {
    async save(input) {
      try {
        return await saveTextAtomically(input, {
          logger: deps.logger,
          openFile: deps.open ?? open,
          removeFile: deps.remove ?? rm,
          renameFile: deps.rename ?? rename,
        })
      } catch (error) {
        if (isDocumentTextSaveError(error)) throw error
        throw new DocumentTextSaveError("WRITE_FAILED", { cause: error })
      }
    },
  }
}

export function serializeDocumentTextSaveError(error: unknown): {
  readonly code: DocumentTextSaveError["code"]
  readonly message: string
} {
  const normalized = isDocumentTextSaveError(error)
    ? error
    : new DocumentTextSaveError("WRITE_FAILED", { cause: error })
  return { code: normalized.code, message: normalized.message }
}

async function saveTextAtomically(
  input: DocumentTextSaveInput,
  deps: {
    readonly logger?: DocumentTextSaveLogger
    readonly openFile: OpenFile
    readonly removeFile: RemoveFile
    readonly renameFile: RenameFile
  },
): Promise<DocumentTextSaveResult> {
  const parsed = documentTextSaveInputSchema.parse(input)
  if (path.extname(parsed.outputPath).toLowerCase() !== ".txt") {
    throw new DocumentTextSaveError("INVALID_OUTPUT")
  }

  const initialTarget = await inspectOutputTarget(parsed.outputPath)
  const bytes = Buffer.from(parsed.text, "utf8")
  const temporaryPath = path.join(
    path.dirname(parsed.outputPath),
    `.${path.basename(parsed.outputPath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
  let handle: Awaited<ReturnType<typeof open>> | null = null

  try {
    handle = await deps.openFile(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      initialTarget?.mode ?? 0o600,
    )
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = null
    await assertOutputTargetUnchanged(parsed.outputPath, initialTarget)
    await deps.renameFile(temporaryPath, parsed.outputPath)
  } catch (error) {
    if (handle) {
      try {
        await handle.close()
      } catch (cleanupError) {
        logCleanupFailure(deps.logger, "close-temporary-file", cleanupError)
      }
    }
    try {
      await deps.removeFile(temporaryPath, { force: true })
    } catch (cleanupError) {
      logCleanupFailure(deps.logger, "remove-temporary-file", cleanupError)
    }
    throw error
  }

  return {
    outputPath: parsed.outputPath,
    fileName: path.basename(parsed.outputPath),
    size: bytes.byteLength,
  }
}

function logCleanupFailure(
  logger: DocumentTextSaveLogger | undefined,
  operation: "close-temporary-file" | "remove-temporary-file",
  error: unknown,
): void {
  const errorCode = (error as NodeJS.ErrnoException | undefined)?.code
  logger?.warn?.("Document text save cleanup failed.", {
    operation,
    errorCategory: typeof errorCode === "string"
      ? errorCode
      : error instanceof Error
        ? error.name
        : "UNKNOWN",
  })
}

async function inspectOutputTarget(outputPath: string): Promise<TargetIdentity | null> {
  try {
    const target = await lstat(outputPath, { bigint: true })
    if (target.isSymbolicLink() || !target.isFile()) {
      throw new DocumentTextSaveError("UNSAFE_OUTPUT_TARGET")
    }
    return {
      dev: target.dev,
      ino: target.ino,
      mode: Number(target.mode & 0o777n),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null
    throw error
  }
}

async function assertOutputTargetUnchanged(
  outputPath: string,
  initialTarget: TargetIdentity | null,
): Promise<void> {
  const currentTarget = await inspectOutputTarget(outputPath)
  if (initialTarget === null && currentTarget === null) return
  if (
    initialTarget === null
    || currentTarget === null
    || initialTarget.dev !== currentTarget.dev
    || initialTarget.ino !== currentTarget.ino
  ) {
    throw new DocumentTextSaveError("OUTPUT_CHANGED")
  }
}
