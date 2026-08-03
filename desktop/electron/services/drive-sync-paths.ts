import { randomUUID } from "node:crypto"
import { lstat, mkdir, realpath, rename, rm } from "node:fs/promises"
import path from "node:path"

const PATH_OUTSIDE_BINDING_MESSAGE = "同步路径超出绑定目录。"
const PATH_CONTAINS_SYMLINK_MESSAGE = "同步路径包含符号链接，已停止写入。"

export function normalizeLocalPath(input: string): string {
  return path.resolve(input)
}

export function driveSyncLocalWriteRootPath(input: { readonly kind: "file" | "folder"; readonly localPath: string }): string {
  const localPath = normalizeLocalPath(input.localPath)
  return input.kind === "folder" ? localPath : path.dirname(localPath)
}

export function assertInsideBindingRoot(rootPath: string, targetPath: string): string {
  const root = normalizeLocalPath(rootPath)
  const target = normalizeLocalPath(targetPath)
  const relative = path.relative(root, target)
  if (relative === "") return target
  if (isOutsideRoot(relative)) {
    throw new Error(PATH_OUTSIDE_BINDING_MESSAGE)
  }
  return target
}

export function toDriveSyncRelativePath(rootPath: string, targetPath: string): string {
  const root = normalizeLocalPath(rootPath)
  const target = assertInsideBindingRoot(root, targetPath)
  const relative = path.relative(root, target)
  return toPosixPath(relative)
}

export function resolveBindingChildPath(rootPath: string, relativePath: string): string {
  assertSafeRelativePath(relativePath)
  return assertInsideBindingRoot(rootPath, path.join(rootPath, relativePath))
}

export async function prepareDriveSyncTargetPath(rootPath: string, targetPath: string): Promise<string> {
  const target = assertInsideBindingRoot(rootPath, targetPath)
  const parent = path.dirname(target)
  await assertNoSymlinkPathComponents(rootPath, parent)
  await mkdir(parent, { recursive: true })
  await assertNoSymlinkPathComponents(rootPath, parent)
  await assertNotExistingSymlink(target)
  return target
}

export async function createDriveSyncDirectoryTarget(rootPath: string, targetPath: string): Promise<string> {
  const root = normalizeLocalPath(rootPath)
  const target = assertInsideBindingRoot(root, targetPath)
  const parent = path.dirname(target)
  if (target !== root) {
    await assertNoSymlinkPathComponents(root, parent)
    await mkdir(parent, { recursive: true })
    await assertNoSymlinkPathComponents(root, parent)
  }
  await assertNotExistingSymlink(target)
  await mkdir(target, { recursive: true })
  await assertNoSymlinkPathComponents(root, target)
  return target
}

export async function writeDriveSyncFileTarget(
  rootPath: string,
  targetPath: string,
  writeTempFile: (tempPath: string) => Promise<unknown>,
): Promise<string> {
  const target = await prepareDriveSyncTargetPath(rootPath, targetPath)
  const parent = path.dirname(target)
  const tempPath = path.join(parent, `.synapse-drive-sync-${randomUUID()}.tmp`)
  try {
    await assertNotExistingSymlink(tempPath)
    await writeTempFile(tempPath)
    await assertNoSymlinkPathComponents(rootPath, parent)
    await assertNotExistingSymlink(target)
    await rename(tempPath, target)
    return target
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export function pathCollisionKey(relativePath: string): string {
  return toPosixPath(relativePath).normalize("NFC").toLowerCase()
}

export function assertDriveSyncLocalRelativePathPortable(
  relativePath: string,
  platform: NodeJS.Platform = process.platform,
): void {
  assertSafeRelativePath(relativePath)
  if (platform !== "win32") return
  for (const segment of relativePath.split("/").filter(Boolean)) {
    const stem = segment.split(".")[0]?.toUpperCase() ?? ""
    if (
      /[<>:"|?*\u0000-\u001F]/u.test(segment)
      || /[ .]$/u.test(segment)
      || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(stem)
    ) {
      throw new Error(`云盘路径无法在 Windows 本地创建：${relativePath}`)
    }
  }
}

export function localPathCollisionKey(localPath: string): string {
  return pathCollisionKey(normalizeLocalPath(localPath))
}

export function localPathsOverlap(leftPath: string, rightPath: string): boolean {
  const left = localPathCollisionKey(leftPath)
  const right = localPathCollisionKey(rightPath)
  return localPathCollisionKeysOverlap(left, right)
}

export async function localPathIdentitiesOverlap(leftPath: string, rightPath: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    localPathIdentityCollisionKey(leftPath),
    localPathIdentityCollisionKey(rightPath),
  ])
  return localPathCollisionKeysOverlap(left, right)
}

async function localPathIdentityCollisionKey(localPath: string): Promise<string> {
  return pathCollisionKey(await resolveLocalPathIdentityPath(localPath))
}

async function resolveLocalPathIdentityPath(input: string): Promise<string> {
  const normalized = normalizeLocalPath(input)
  let current = normalized
  while (true) {
    try {
      const currentRealPath = await realpath(current)
      const relativeTail = path.relative(current, normalized)
      return relativeTail ? path.join(currentRealPath, relativeTail) : currentRealPath
    } catch (error) {
      if (!isNodeErrorCode(error, "ENOENT") && !isNodeErrorCode(error, "ENOTDIR")) throw error
      const parent = path.dirname(current)
      if (parent === current) return normalized
      current = parent
    }
  }
}

function localPathCollisionKeysOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

function assertSafeRelativePath(relativePath: string): void {
  if (relativePath === "") return
  if (path.isAbsolute(relativePath) || /^[A-Za-z]:[\\/]/u.test(relativePath)) {
    throw new Error(PATH_OUTSIDE_BINDING_MESSAGE)
  }
  const segments = relativePath.split(/[\\/]+/u)
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(PATH_OUTSIDE_BINDING_MESSAGE)
  }
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/")
}

export async function assertNoSymlinkPathComponents(rootPath: string, targetPath: string): Promise<void> {
  const root = normalizeLocalPath(rootPath)
  const target = assertInsideBindingRoot(root, targetPath)
  await assertNotExistingSymlink(root)
  const rootRealPath = await realpath(root)
  const relative = path.relative(root, target)
  if (relative === "") return
  let current = root
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    await assertExistingPathInsideRealRoot(rootRealPath, current)
  }
}

async function assertExistingPathInsideRealRoot(rootRealPath: string, targetPath: string): Promise<void> {
  try {
    const stats = await lstat(targetPath)
    if (stats.isSymbolicLink()) throw new Error(PATH_CONTAINS_SYMLINK_MESSAGE)
    assertInsideRealRoot(rootRealPath, await realpath(targetPath))
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return
    throw error
  }
}

async function assertNotExistingSymlink(targetPath: string): Promise<void> {
  try {
    const stats = await lstat(targetPath)
    if (stats.isSymbolicLink()) throw new Error(PATH_CONTAINS_SYMLINK_MESSAGE)
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return
    throw error
  }
}

function assertInsideRealRoot(rootRealPath: string, targetRealPath: string): void {
  const relative = path.relative(rootRealPath, targetRealPath)
  if (relative === "") return
  if (isOutsideRoot(relative)) {
    throw new Error(PATH_OUTSIDE_BINDING_MESSAGE)
  }
}

function isOutsideRoot(relativePath: string): boolean {
  return relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code
}
