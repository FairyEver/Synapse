import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { errorLogCode, errorLogName } from "./error-sanitize"
import { isFileNotFoundError, isPermissionError, pathExists } from "./fs-utils"
import { createMainLogger } from "./log-store"

const logger = createMainLogger("service.editor-file-write")

interface EditorWriteErrorLogMeta {
  errorName: string
  errorCode?: string
}

function normalizeMarkdownContent(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`
}

function createEditorWriteErrorLogMeta(error: unknown): EditorWriteErrorLogMeta {
  const errorCode = errorLogCode(error)
  return {
    errorName: errorLogName(error),
    ...(errorCode ? { errorCode } : {}),
  }
}

function isRawEditorWriteError(error: unknown, targetPath: string): boolean {
  if (!error || typeof error !== "object") return false
  if (errorLogCode(error)) return true
  return error instanceof Error && error.message.includes(targetPath)
}

type AtomicSwapOptions = {
  readonly beforeSwap?: () => Promise<void>
  readonly afterMoveExistingTarget?: (movedTargetPath: string) => Promise<void>
  readonly beforeRestoreMovedTarget?: (movedTargetPath: string) => Promise<void>
}

class AtomicSwapRestoreError extends Error {
  constructor(cause: unknown) {
    super("原目标自动恢复失败，请手动处理保留的目标和备份。", { cause })
  }
}

async function pathEntryExists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath)
    return true
  } catch (error) {
    if (isFileNotFoundError(error)) return false
    throw error
  }
}

async function swapPathAtomically(
  replacementPath: string,
  targetPath: string,
  options: AtomicSwapOptions = {},
): Promise<void> {
  const parentDirectoryPath = path.dirname(targetPath)
  const targetName = path.basename(targetPath)

  await mkdir(parentDirectoryPath, { recursive: true })

  const backupPath = path.join(
    parentDirectoryPath,
    `.synapse-install-backup-${targetName}-${Date.now()}`,
  )
  const hadExistingTarget = await pathExists(targetPath)
  let movedExistingTarget = false
  let movedReplacement = false

  try {
    await options.beforeSwap?.()

    if (hadExistingTarget) {
      await rename(targetPath, backupPath)
      movedExistingTarget = true
      await options.afterMoveExistingTarget?.(backupPath)
    }

    await rename(replacementPath, targetPath)
    movedReplacement = true
  } catch (error) {
    if (movedExistingTarget && !movedReplacement) {
      try {
        if (await pathEntryExists(targetPath)) {
          throw new Error("atomic swap target reappeared before restore", { cause: error })
        }
        await options.beforeRestoreMovedTarget?.(backupPath)
        await rename(backupPath, targetPath)
      } catch (restoreError) {
        logger.warn("Failed to safely restore atomic swap backup", {
          targetName,
          ...createEditorWriteErrorLogMeta(restoreError),
        })
        throw new AtomicSwapRestoreError(restoreError)
      }
    }

    throw error
  } finally {
    if (movedExistingTarget && movedReplacement) {
      await rm(backupPath, { recursive: true, force: true })
        .catch((err) => logger.warn("Failed to clean up backup", createEditorWriteErrorLogMeta(err)))
    }
  }
}

async function readExistingTextFile(targetPath: string): Promise<string> {
  try {
    return await readFile(targetPath, "utf8")
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return ""
    }

    throw error
  }
}

async function replaceFileAtomically(targetPath: string, content: string): Promise<void> {
  const parentDirectoryPath = path.dirname(targetPath)

  await mkdir(parentDirectoryPath, { recursive: true })

  const tempDirectoryPath = await mkdtemp(path.join(parentDirectoryPath, ".synapse-install-file-"))
  const tempFilePath = path.join(tempDirectoryPath, path.basename(targetPath))

  try {
    await writeFile(tempFilePath, normalizeMarkdownContent(content), "utf8")
    await swapPathAtomically(tempFilePath, targetPath)
    logger.info("Wrote file atomically.", { targetName: path.basename(targetPath) })
  } finally {
    await rm(tempDirectoryPath, { recursive: true, force: true })
      .catch((err) => logger.warn("Failed to clean up temp directory", createEditorWriteErrorLogMeta(err)))
  }
}

async function replaceDirectoryAtomically(
  targetPath: string,
  populate: (stagingDirectoryPath: string) => Promise<void>,
  options: AtomicSwapOptions = {},
): Promise<void> {
  const parentDirectoryPath = path.dirname(targetPath)

  await mkdir(parentDirectoryPath, { recursive: true })

  const stagingDirectoryPath = await mkdtemp(path.join(parentDirectoryPath, ".synapse-install-dir-"))

  try {
    await populate(stagingDirectoryPath)
    await swapPathAtomically(stagingDirectoryPath, targetPath, options)
  } catch (error) {
    await rm(stagingDirectoryPath, { recursive: true, force: true })
      .catch((err) => logger.warn("Failed to clean up staging directory", createEditorWriteErrorLogMeta(err)))
    throw error
  }
}

function formatEditorWriteFailure(error: unknown, targetPath: string): Error {
  if (isPermissionError(error)) {
    return new Error(`目标位置不可写：${path.basename(targetPath)}`)
  }

  if (isRawEditorWriteError(error, targetPath)) {
    return new Error("写入失败，请稍后重试。")
  }

  if (error instanceof Error) {
    return error
  }

  return new Error("写入失败，请稍后重试。")
}

export {
  createEditorWriteErrorLogMeta,
  formatEditorWriteFailure,
  normalizeMarkdownContent,
  readExistingTextFile,
  replaceDirectoryAtomically,
  replaceFileAtomically,
}
