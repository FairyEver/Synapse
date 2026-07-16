import type { BigIntStats } from "node:fs"
import { access } from "node:fs/promises"
import path from "node:path"

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function isPermissionError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EACCES" || error.code === "EPERM")
  )
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false
    }
    throw error
  }
}

function isPathInside(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath)
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

function hasSameFileSnapshot(expected: BigIntStats, actual: BigIntStats): boolean {
  return expected.dev === actual.dev
    && expected.ino === actual.ino
    && expected.mode === actual.mode
    && expected.size === actual.size
    && expected.mtimeNs === actual.mtimeNs
    && expected.ctimeNs === actual.ctimeNs
}

export { hasSameFileSnapshot, isFileNotFoundError, isPathInside, isPermissionError, pathExists }
