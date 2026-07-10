import { constants } from "node:fs"
import { lstat, open, readFile, readdir, realpath, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  assertNoRuntimeSkillEnvPath,
  SKILL_ENV_EXAMPLE_PATH,
  SKILL_RUNTIME_ENV_PATH,
} from "../../../src/lib/content-attachments"
import { arePathsEqualForCompare } from "../../../src/lib/path-compare"
import { createDotenvFromExample, mergeDotenvExample } from "./dotenv-document"
import { SKILL_RUNTIME_ENV_MAX_BYTES } from "./file-policy"

export type MaterializeSkillEnvInput = {
  readonly stagingDirectoryPath: string
  readonly existingTargetDirectoryPath: string
  readonly values: Readonly<Record<string, string>>
  readonly registerPrecondition?: (guard: SkillEnvMaterializationGuard) => void
}

export type SkillEnvMaterializationGuard = {
  readonly validate: () => Promise<void>
  readonly validateMovedTarget: (movedTargetPath: string) => Promise<void>
  readonly validateMovedTargetForRestore: (movedTargetPath: string) => Promise<void>
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "ENOENT"
}

function isSymlinkOpenError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && (error.code === "ELOOP" || error.code === "EMLINK")
}

function createChangedEnvError(): Error {
  return new Error("Skill .env 在读取期间发生变化。")
}

function createChangedTargetDirectoryError(): Error {
  return new Error("Skill 目标目录在读取 .env 期间发生变化。")
}

function createOversizedEnvError(): Error {
  return new Error("Skill .env 超过 1 MiB 限制。")
}

function assertRegularEnvEntry(entry: { isFile(): boolean; isSymbolicLink(): boolean }): void {
  if (entry.isSymbolicLink()) {
    throw new Error("Skill .env 不能是符号链接。")
  }
  if (!entry.isFile()) {
    throw new Error("Skill .env 必须是普通文件。")
  }
}

function assertTargetDirectoryEntry(
  entry: { isDirectory(): boolean; isSymbolicLink(): boolean },
): void {
  if (entry.isSymbolicLink()) {
    throw new Error("Skill 目标目录不能是符号链接。")
  }
  if (!entry.isDirectory()) {
    throw new Error("Skill 目标目录必须是普通目录。")
  }
}

type EntryIdentity = {
  readonly dev: bigint
  readonly ino: bigint
}

type TargetDirectoryIdentity = EntryIdentity & {
  readonly realPath: string
}

type FileSnapshot = EntryIdentity & {
  readonly ctimeNs: bigint
  readonly mtimeNs: bigint
  readonly size: bigint
}

type ExistingEnvSnapshot = {
  readonly content: Buffer
  readonly file: FileSnapshot
}

function hasSameIdentity(left: EntryIdentity, right: EntryIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function assertUsableIdentity(entry: EntryIdentity, label: string): void {
  if (entry.ino === 0n) {
    throw new Error(`${label}身份无法安全确认。`)
  }
}

function isSameFilesystemPath(left: string, right: string): boolean {
  return arePathsEqualForCompare(left, right, {
    platform: process.platform,
    resolvePath: path.resolve,
  })
}

async function assertSameTargetDirectory(
  targetPath: string,
  expected: TargetDirectoryIdentity,
): Promise<void> {
  let current
  try {
    current = await lstat(targetPath, { bigint: true })
  } catch (error) {
    if (isMissingPathError(error)) throw createChangedTargetDirectoryError()
    throw error
  }
  assertTargetDirectoryEntry(current)
  assertUsableIdentity(current, "Skill 目标目录")
  if (!hasSameIdentity(current, expected)) {
    throw createChangedTargetDirectoryError()
  }

  let currentRealPath: string
  try {
    currentRealPath = await realpath(targetPath)
  } catch (error) {
    if (isMissingPathError(error)) throw createChangedTargetDirectoryError()
    throw error
  }
  if (!isSameFilesystemPath(currentRealPath, expected.realPath)) {
    throw createChangedTargetDirectoryError()
  }
}

async function readTargetDirectoryIdentity(
  targetPath: string,
): Promise<TargetDirectoryIdentity | null> {
  let entry
  try {
    entry = await lstat(targetPath, { bigint: true })
  } catch (error) {
    if (isMissingPathError(error)) return null
    throw error
  }
  assertTargetDirectoryEntry(entry)
  assertUsableIdentity(entry, "Skill 目标目录")
  const identity = {
    dev: entry.dev,
    ino: entry.ino,
    realPath: await realpath(targetPath),
  }
  await assertSameTargetDirectory(targetPath, identity)
  return identity
}

function hasSameFileSnapshot(left: FileSnapshot, right: FileSnapshot): boolean {
  return hasSameIdentity(left, right)
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
}

async function assertEnvPathMatchesOpenedFile(
  existingEnvPath: string,
  openedEntry: FileSnapshot,
  targetDirectory: TargetDirectoryIdentity,
): Promise<void> {
  let currentEntry
  try {
    currentEntry = await lstat(existingEnvPath, { bigint: true })
  } catch (error) {
    if (isMissingPathError(error)) throw createChangedEnvError()
    throw error
  }
  assertRegularEnvEntry(currentEntry)
  assertUsableIdentity(currentEntry, "Skill .env 文件")
  if (!hasSameIdentity(openedEntry, currentEntry)) {
    throw createChangedEnvError()
  }

  let envRealPath: string
  try {
    envRealPath = await realpath(existingEnvPath)
  } catch (error) {
    if (isMissingPathError(error)) throw createChangedEnvError()
    throw error
  }
  const expectedEnvRealPath = path.join(targetDirectory.realPath, SKILL_RUNTIME_ENV_PATH)
  if (!isSameFilesystemPath(envRealPath, expectedEnvRealPath)) {
    throw createChangedEnvError()
  }
}

async function readExistingEnv(
  targetPath: string,
  targetDirectory: TargetDirectoryIdentity,
): Promise<ExistingEnvSnapshot | null> {
  const existingEnvPath = path.join(targetPath, SKILL_RUNTIME_ENV_PATH)
  await assertSameTargetDirectory(targetPath, targetDirectory)
  try {
    assertRegularEnvEntry(await lstat(existingEnvPath, { bigint: true }))
  } catch (error) {
    if (isMissingPathError(error)) {
      await assertSameTargetDirectory(targetPath, targetDirectory)
      return null
    }
    throw error
  }

  let handle
  try {
    const noFollowFlag = typeof constants.O_NOFOLLOW === "number"
      ? constants.O_NOFOLLOW
      : 0
    const nonBlockingFlag = typeof constants.O_NONBLOCK === "number"
      ? constants.O_NONBLOCK
      : 0
    handle = await open(
      existingEnvPath,
      constants.O_RDONLY | noFollowFlag | nonBlockingFlag,
    )
  } catch (error) {
    if (isSymlinkOpenError(error)) {
      throw new Error("Skill .env 不能是符号链接。", { cause: error })
    }
    if (isMissingPathError(error)) throw createChangedEnvError()
    throw error
  }

  try {
    const openedEntry = await handle.stat({ bigint: true })
    if (!openedEntry.isFile()) {
      throw new Error("Skill .env 必须是普通文件。")
    }
    assertUsableIdentity(openedEntry, "Skill .env 文件")
    await assertEnvPathMatchesOpenedFile(existingEnvPath, openedEntry, targetDirectory)
    await assertSameTargetDirectory(targetPath, targetDirectory)

    const content = await readBoundedEnvSnapshot(handle, openedEntry.size)
    const finalOpenedEntry = await handle.stat({ bigint: true })
    if (!hasSameFileSnapshot(openedEntry, finalOpenedEntry)) {
      throw createChangedEnvError()
    }
    await assertEnvPathMatchesOpenedFile(existingEnvPath, openedEntry, targetDirectory)
    await assertSameTargetDirectory(targetPath, targetDirectory)
    return {
      content,
      file: {
        ctimeNs: openedEntry.ctimeNs,
        dev: openedEntry.dev,
        ino: openedEntry.ino,
        mtimeNs: openedEntry.mtimeNs,
        size: openedEntry.size,
      },
    }
  } finally {
    await handle.close()
  }
}

async function readBoundedEnvSnapshot(
  handle: Awaited<ReturnType<typeof open>>,
  expectedSize: bigint,
): Promise<Buffer> {
  if (expectedSize < 0n || expectedSize > SKILL_RUNTIME_ENV_MAX_BYTES) {
    throw createOversizedEnvError()
  }

  const byteLength = Number(expectedSize)
  const content = Buffer.allocUnsafe(byteLength)
  let offset = 0
  while (offset < byteLength) {
    const { bytesRead } = await handle.read(content, offset, byteLength - offset, offset)
    if (bytesRead <= 0) throw createChangedEnvError()
    offset += bytesRead
  }

  const trailingByte = Buffer.allocUnsafe(1)
  const { bytesRead: trailingBytesRead } = await handle.read(
    trailingByte,
    0,
    1,
    byteLength,
  )
  if (trailingBytesRead !== 0) throw createChangedEnvError()
  return content
}

async function assertStagingHasNoRuntimeEnv(stagingDirectoryPath: string): Promise<void> {
  const entries = await readdir(stagingDirectoryPath, { withFileTypes: true })
  assertNoRuntimeSkillEnvPath(entries.map((entry) => entry.name))
}

async function assertTargetStillMissing(targetPath: string): Promise<void> {
  try {
    await lstat(targetPath, { bigint: true })
  } catch (error) {
    if (isMissingPathError(error)) return
    throw error
  }
  throw createChangedTargetDirectoryError()
}

function createMaterializationGuard(
  targetPath: string,
  targetDirectory: TargetDirectoryIdentity | null,
  existingEnv: ExistingEnvSnapshot | null,
): SkillEnvMaterializationGuard {
  async function assertExpectedEnv(targetDirectoryPath: string, directory: TargetDirectoryIdentity): Promise<void> {
    const currentEnv = await readExistingEnv(targetDirectoryPath, directory)
    if (existingEnv === null) {
      if (currentEnv !== null) throw createChangedEnvError()
      return
    }
    if (
      currentEnv === null
      || !hasSameFileSnapshot(currentEnv.file, existingEnv.file)
      || !currentEnv.content.equals(existingEnv.content)
    ) {
      throw createChangedEnvError()
    }
  }

  return {
    async validate() {
      if (targetDirectory === null) {
        await assertTargetStillMissing(targetPath)
        return
      }

      await assertSameTargetDirectory(targetPath, targetDirectory)
      await assertExpectedEnv(targetPath, targetDirectory)
    },
    async validateMovedTarget(movedTargetPath) {
      if (targetDirectory === null) throw createChangedTargetDirectoryError()
      const movedDirectory = await readMovedTargetDirectoryIdentity(
        movedTargetPath,
        targetDirectory,
      )
      await assertExpectedEnv(movedTargetPath, movedDirectory)
    },
    async validateMovedTargetForRestore(movedTargetPath) {
      if (targetDirectory === null) throw createChangedTargetDirectoryError()
      await readMovedTargetDirectoryIdentity(movedTargetPath, targetDirectory)
    },
  }
}

async function readMovedTargetDirectoryIdentity(
  movedTargetPath: string,
  expected: TargetDirectoryIdentity,
): Promise<TargetDirectoryIdentity> {
  let movedEntry
  try {
    movedEntry = await lstat(movedTargetPath, { bigint: true })
  } catch (error) {
    if (isMissingPathError(error)) throw createChangedTargetDirectoryError()
    throw error
  }
  assertTargetDirectoryEntry(movedEntry)
  assertUsableIdentity(movedEntry, "Skill 目标目录")
  if (!hasSameIdentity(movedEntry, expected)) throw createChangedTargetDirectoryError()

  const [movedRealPath, movedParentRealPath] = await Promise.all([
    realpath(movedTargetPath),
    realpath(path.dirname(movedTargetPath)),
  ])
  if (
    !isSameFilesystemPath(path.dirname(movedRealPath), movedParentRealPath)
    || !isSameFilesystemPath(movedParentRealPath, path.dirname(expected.realPath))
  ) {
    throw createChangedTargetDirectoryError()
  }

  const movedIdentity = {
    dev: movedEntry.dev,
    ino: movedEntry.ino,
    realPath: movedRealPath,
  }
  await assertSameTargetDirectory(movedTargetPath, movedIdentity)
  return movedIdentity
}

export async function materializeSkillEnv(
  input: MaterializeSkillEnvInput,
): Promise<"created" | "merged" | "absent"> {
  const stagedExamplePath = path.join(input.stagingDirectoryPath, SKILL_ENV_EXAMPLE_PATH)
  const stagedEnvPath = path.join(input.stagingDirectoryPath, SKILL_RUNTIME_ENV_PATH)

  await assertStagingHasNoRuntimeEnv(input.stagingDirectoryPath)
  const targetDirectory = await readTargetDirectoryIdentity(input.existingTargetDirectoryPath)
  const existing = targetDirectory === null
    ? null
    : await readExistingEnv(input.existingTargetDirectoryPath, targetDirectory)
  input.registerPrecondition?.(createMaterializationGuard(
    input.existingTargetDirectoryPath,
    targetDirectory,
    existing,
  ))

  let example: string
  try {
    example = await readFile(stagedExamplePath, "utf8")
  } catch (error) {
    if (isMissingPathError(error)) {
      if (existing === null) return "absent"
      await writeFile(stagedEnvPath, existing.content)
      return "merged"
    }
    throw error
  }

  const content = existing === null
    ? createDotenvFromExample(example, input.values)
    : mergeDotenvExample(existing.content.toString("utf8"), example, input.values)
  await writeFile(stagedEnvPath, content, "utf8")
  return existing === null ? "created" : "merged"
}
