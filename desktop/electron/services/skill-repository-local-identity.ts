import { randomUUID } from "node:crypto"
import { constants, type BigIntStats } from "node:fs"
import { lstat, open, realpath, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { SKILL_REPOSITORY_IDENTITY_MAX_BYTES } from "../../config"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
import { hasSameFileSnapshot, isFileNotFoundError, isPathInside, readFileHandleUpTo } from "./fs-utils"

const sharedSkillRepositoryPromise = import("@synapse/shared")
export const SKILL_REPOSITORY_ID_FILE_NAME = ".synapse.repository.json"
export const LEGACY_SKILL_REPOSITORY_ID_FILE_NAME = ".synapse.json"

export type SkillRepositoryIdentity = {
  readonly id: string
  readonly kind: "cloud-skill-repository"
  readonly owner: string | null
  readonly name: string
}

export type SkillRepositoryIdentityWriteSecurity = {
  readonly actor: ActorIdentity
  readonly auditSink: Pick<AuditSink, "record">
  readonly permissionGuard: Pick<PermissionGuard, "check">
}

export type SkillRepositoryIdentityReadSecurity = SkillRepositoryIdentityWriteSecurity

export type SkillRepositoryIdentityWriteOptions = {
  readonly validateSource?: () => Promise<void>
}

type SkillRepositoryIdentityAuditOutcome = "allowed" | "denied" | "failed"

export class SkillRepositoryIdentityChangedError extends Error {
  constructor() {
    super("本地 Skill 的云仓库关联已发生变化，请重新扫描后再试。")
    this.name = "SkillRepositoryIdentityChangedError"
  }
}

export class SkillRepositoryLegacyIdentityChangedError extends Error {
  constructor() {
    super("本地 Skill 的旧云仓库身份已发生变化，已跳过清理，请重新扫描后再试。")
    this.name = "SkillRepositoryLegacyIdentityChangedError"
  }
}

export class SkillRepositoryIdentityInvalidError extends Error {
  constructor() {
    super("本地 Skill 的当前云仓库身份无效，请修复 .synapse.repository.json 后重新扫描。")
    this.name = "SkillRepositoryIdentityInvalidError"
  }
}

export class SkillRepositoryIdentityTooLargeError extends Error {
  constructor(fileName: string) {
    super(`本地 Skill 云仓库身份文件不能超过 64 KiB：${fileName}`)
    this.name = "SkillRepositoryIdentityTooLargeError"
  }
}

export class SkillRepositorySourceDirectoryChangedError extends Error {
  constructor(message = "本地 Skill 在上传期间发生变化，请重新扫描后再关联。") {
    super(message)
    this.name = "SkillRepositorySourceDirectoryChangedError"
  }
}

export async function ensureSkillRepositoryIdentityWriteAllowed(
  sourceDirectoryPath: string,
  security?: SkillRepositoryIdentityWriteSecurity,
): Promise<void> {
  if (!security) return
  await checkIdentityWritePermission(security, path.join(sourceDirectoryPath, SKILL_REPOSITORY_ID_FILE_NAME), {
    operation: "skill-repository.identity.write.preflight",
  })
}

export async function writeSkillRepositoryIdentity(
  sourceDirectoryPath: string,
  identity: SkillRepositoryIdentity,
  expectedRaw: string | null,
  security?: SkillRepositoryIdentityWriteSecurity,
  options?: SkillRepositoryIdentityWriteOptions,
): Promise<void> {
  const targetPath = path.join(sourceDirectoryPath, SKILL_REPOSITORY_ID_FILE_NAME)
  let tempPath: string | null = null
  const metadata = {
    operation: "skill-repository.identity.write",
    repositoryId: identity.id,
    repositoryName: identity.name,
  }

  if (security) await checkIdentityWritePermission(security, targetPath, metadata)

  try {
    const expectedSourceDirectory = await inspectSourceDirectory(sourceDirectoryPath)
    tempPath = path.join(sourceDirectoryPath, `${SKILL_REPOSITORY_ID_FILE_NAME}.${randomUUID()}.tmp`)
    await writeFile(tempPath, `${JSON.stringify(identity, null, 2)}\n`, "utf8")
    const currentRaw = await readSkillRepositoryIdentityRaw(sourceDirectoryPath, security)
    if (currentRaw !== expectedRaw) throw new SkillRepositoryIdentityChangedError()
    const currentSourceDirectory = await inspectSourceDirectory(sourceDirectoryPath)
    if (!sameDirectoryIdentity(expectedSourceDirectory, currentSourceDirectory)) {
      throw new SkillRepositorySourceDirectoryChangedError()
    }
    await options?.validateSource?.()
    await rename(tempPath, targetPath)
    tempPath = null
    recordIdentityAudit(security, "fs.write", targetPath, "allowed", metadata)
  } catch (error) {
    if (tempPath) {
      await rm(tempPath, { force: true }).catch(() => undefined)
    }
    recordIdentityAudit(security, "fs.write", targetPath, "failed", {
      ...metadata,
      ...(error instanceof SkillRepositorySourceDirectoryChangedError
        ? { reason: "source-directory-changed" }
        : {}),
    })
    throw error
  }
}

async function inspectSourceDirectory(sourceDirectoryPath: string): Promise<BigIntStats> {
  let sourceDirectory: BigIntStats
  try {
    sourceDirectory = await lstat(sourceDirectoryPath, { bigint: true })
  } catch (error) {
    if (isFileNotFoundError(error)) throw new SkillRepositorySourceDirectoryChangedError()
    throw error
  }
  if (sourceDirectory.isSymbolicLink() || !sourceDirectory.isDirectory()) {
    throw new SkillRepositorySourceDirectoryChangedError()
  }
  return sourceDirectory
}

export async function readSkillRepositoryIdentityRaw(
  sourceDirectoryPath: string,
  security?: SkillRepositoryIdentityReadSecurity,
): Promise<string | null> {
  const filePath = path.join(sourceDirectoryPath, SKILL_REPOSITORY_ID_FILE_NAME)
  const metadata = {
    operation: "skill-repository.identity.read-snapshot",
    identitySource: "current",
  }
  const raw = await readIdentityRaw(sourceDirectoryPath, filePath, SKILL_REPOSITORY_ID_FILE_NAME, metadata, security)
  if (raw !== null) {
    recordIdentityAudit(security, "fs.read.outside-userdata", filePath, "allowed", {
      ...metadata,
      identityFound: true,
    })
  }
  return raw
}

export async function readSkillRepositoryIdentity(
  sourceDirectoryPath: string,
  security?: SkillRepositoryIdentityReadSecurity,
): Promise<SkillRepositoryIdentity | null> {
  const current = await readIdentityFile(
    sourceDirectoryPath,
    SKILL_REPOSITORY_ID_FILE_NAME,
    "current",
    security,
  )
  if (current) return current
  return readIdentityFile(
    sourceDirectoryPath,
    LEGACY_SKILL_REPOSITORY_ID_FILE_NAME,
    "legacy",
    security,
  )
}

export async function removeLegacySkillRepositoryIdentity(
  sourceDirectoryPath: string,
  security?: SkillRepositoryIdentityWriteSecurity,
): Promise<boolean> {
  const legacyPath = path.join(sourceDirectoryPath, LEGACY_SKILL_REPOSITORY_ID_FILE_NAME)
  const legacySnapshot = await readIdentityFileSnapshot(
    sourceDirectoryPath,
    LEGACY_SKILL_REPOSITORY_ID_FILE_NAME,
    "legacy",
    security,
  )
  if (!legacySnapshot) return false

  const metadata = {
    operation: "skill-repository.identity.migrate",
    repositoryId: legacySnapshot.identity.id,
  }
  if (security) await checkIdentityWritePermission(security, legacyPath, metadata)

  try {
    const recheckMetadata = { ...metadata, operation: "skill-repository.identity.migrate-recheck" }
    const currentRaw = await readIdentityRaw(
      sourceDirectoryPath,
      legacyPath,
      LEGACY_SKILL_REPOSITORY_ID_FILE_NAME,
      recheckMetadata,
      security,
    )
    if (currentRaw !== null) {
      recordIdentityAudit(security, "fs.read.outside-userdata", legacyPath, "allowed", {
        ...recheckMetadata,
        identityFound: true,
      })
    }
    if (currentRaw !== legacySnapshot.raw) throw new SkillRepositoryLegacyIdentityChangedError()
    await rm(legacyPath)
    recordIdentityAudit(security, "fs.write", legacyPath, "allowed", metadata)
    return true
  } catch (error) {
    recordIdentityAudit(security, "fs.write", legacyPath, "failed", {
      ...metadata,
      ...(error instanceof SkillRepositoryLegacyIdentityChangedError
        ? { reason: "legacy-identity-changed" }
        : {}),
    })
    throw error
  }
}

async function readIdentityFile(
  sourceDirectoryPath: string,
  fileName: string,
  identitySource: "current" | "legacy",
  security?: SkillRepositoryIdentityReadSecurity,
): Promise<SkillRepositoryIdentity | null> {
  const snapshot = await readIdentityFileSnapshot(sourceDirectoryPath, fileName, identitySource, security)
  return snapshot?.identity ?? null
}

async function readIdentityFileSnapshot(
  sourceDirectoryPath: string,
  fileName: string,
  identitySource: "current" | "legacy",
  security?: SkillRepositoryIdentityReadSecurity,
): Promise<{ readonly identity: SkillRepositoryIdentity; readonly raw: string } | null> {
  const filePath = path.join(sourceDirectoryPath, fileName)
  const metadata = {
    operation: "skill-repository.identity.read",
    identitySource,
  }
  const raw = await readIdentityRaw(sourceDirectoryPath, filePath, fileName, metadata, security)
  if (raw === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return handleInvalidIdentity(filePath, metadata, identitySource, security)
  }

  if (!parsed || typeof parsed !== "object") {
    return handleInvalidIdentity(filePath, metadata, identitySource, security)
  }
  const candidate = parsed as Record<string, unknown>
  if (
    candidate.kind !== "cloud-skill-repository"
    || typeof candidate.id !== "string"
    || !candidate.id.trim()
    || typeof candidate.name !== "string"
    || !candidate.name.trim()
  ) {
    return handleInvalidIdentity(filePath, metadata, identitySource, security)
  }

  const { normalizeSkillRepositoryName } = await sharedSkillRepositoryPromise
  let name: string
  try {
    name = normalizeSkillRepositoryName(candidate.name)
  } catch {
    return handleInvalidIdentity(filePath, metadata, identitySource, security)
  }

  const identity: SkillRepositoryIdentity = {
    id: candidate.id.trim(),
    kind: "cloud-skill-repository",
    owner: typeof candidate.owner === "string" && candidate.owner.trim() ? candidate.owner.trim() : null,
    name,
  }
  recordIdentityAudit(security, "fs.read.outside-userdata", filePath, "allowed", {
    ...metadata,
    identityFound: true,
    repositoryId: identity.id,
  })
  return { identity, raw }
}

function handleInvalidIdentity(
  filePath: string,
  metadata: Record<string, unknown>,
  identitySource: "current" | "legacy",
  security?: SkillRepositoryIdentityReadSecurity,
): null {
  const shouldReject = identitySource === "current"
  recordIdentityAudit(
    security,
    "fs.read.outside-userdata",
    filePath,
    shouldReject ? "failed" : "allowed",
    {
      ...metadata,
      identityFound: false,
      ...(shouldReject ? { reason: "invalid-identity" } : {}),
    },
  )
  if (shouldReject) throw new SkillRepositoryIdentityInvalidError()
  return null
}

async function readIdentityRaw(
  sourceDirectoryPath: string,
  filePath: string,
  fileName: string,
  metadata: Record<string, unknown>,
  security?: SkillRepositoryIdentityReadSecurity,
): Promise<string | null> {
  let expected: BigIntStats
  try {
    expected = await lstat(filePath, { bigint: true })
  } catch (error) {
    if (isFileNotFoundError(error)) return null
    recordIdentityAudit(security, "fs.read.outside-userdata", filePath, "failed", metadata)
    throw error
  }
  if (expected.isSymbolicLink()) {
    recordIdentityAudit(security, "fs.read.outside-userdata", filePath, "failed", metadata)
    throw new Error(`Skill 云仓库身份文件不能是符号链接：${fileName}`)
  }
  if (!expected.isFile()) {
    recordIdentityAudit(security, "fs.read.outside-userdata", filePath, "failed", metadata)
    throw new Error(`Skill 云仓库身份必须是普通文件：${fileName}`)
  }
  if (expected.size > BigInt(SKILL_REPOSITORY_IDENTITY_MAX_BYTES)) {
    recordIdentityAudit(security, "fs.read.outside-userdata", filePath, "failed", {
      ...metadata,
      reason: "identity-too-large",
      maxBytes: SKILL_REPOSITORY_IDENTITY_MAX_BYTES,
    })
    throw new SkillRepositoryIdentityTooLargeError(fileName)
  }

  if (security) await checkIdentityReadPermission(security, filePath, metadata)

  let raw: string
  try {
    raw = await readVerifiedIdentityFile(sourceDirectoryPath, filePath, expected)
  } catch (error) {
    recordIdentityAudit(security, "fs.read.outside-userdata", filePath, "failed", {
      ...metadata,
      ...(error instanceof SkillRepositoryIdentityTooLargeError
        ? { reason: "identity-too-large", maxBytes: SKILL_REPOSITORY_IDENTITY_MAX_BYTES }
        : {}),
    })
    throw error
  }
  return raw
}

async function readVerifiedIdentityFile(
  sourceDirectoryPath: string,
  filePath: string,
  expected: BigIntStats,
): Promise<string> {
  const [sourceRealPath, fileRealPath] = await Promise.all([
    realpath(sourceDirectoryPath),
    realpath(filePath),
  ])
  if (!isPathInside(sourceRealPath, fileRealPath)) {
    throw new Error("Skill 云仓库身份文件必须位于 Skill 源目录内。")
  }

  const noFollowFlag = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
  const nonBlockingFlag = typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0
  const handle = await open(filePath, constants.O_RDONLY | noFollowFlag | nonBlockingFlag)
  try {
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !hasSameFileSnapshot(expected, opened)) {
      throw new Error("Skill 云仓库身份文件在读取前发生变化。")
    }
    const raw = await readBoundedIdentityFile(handle, path.basename(filePath))
    const [afterRead, pathAfterRead, realPathAfterRead] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(filePath, { bigint: true }),
      realpath(filePath),
    ])
    if (
      pathAfterRead.isSymbolicLink()
      || !pathAfterRead.isFile()
      || !hasSameFileSnapshot(expected, afterRead)
      || !hasSameFileSnapshot(expected, pathAfterRead)
      || !isPathInside(sourceRealPath, realPathAfterRead)
    ) {
      throw new Error("Skill 云仓库身份文件在读取期间发生变化。")
    }
    return raw
  } finally {
    await handle.close()
  }
}

async function readBoundedIdentityFile(handle: Awaited<ReturnType<typeof open>>, fileName: string): Promise<string> {
  const buffer = await readFileHandleUpTo(handle, SKILL_REPOSITORY_IDENTITY_MAX_BYTES + 1)
  if (buffer.byteLength > SKILL_REPOSITORY_IDENTITY_MAX_BYTES) {
    throw new SkillRepositoryIdentityTooLargeError(fileName)
  }
  return buffer.toString("utf8")
}

function sameDirectoryIdentity(expected: BigIntStats, actual: BigIntStats): boolean {
  return expected.dev === actual.dev
    && expected.ino === actual.ino
    && expected.mode === actual.mode
}

async function checkIdentityReadPermission(
  security: SkillRepositoryIdentityReadSecurity,
  resource: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const permission = await security.permissionGuard.check({
    action: "fs.read.outside-userdata",
    actor: security.actor,
    resource,
    context: metadata,
  })
  if (!permission.allowed) {
    recordIdentityAudit(security, "fs.read.outside-userdata", resource, "denied", {
      ...metadata,
      reason: permission.reason,
      policyId: permission.policyId,
    })
    throw new Error(permission.reason)
  }
}

async function checkIdentityWritePermission(
  security: SkillRepositoryIdentityWriteSecurity,
  resource: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const permission = await security.permissionGuard.check({
    action: "fs.write",
    actor: security.actor,
    resource,
    context: metadata,
  })
  if (!permission.allowed) {
    recordIdentityAudit(security, "fs.write", resource, "denied", {
      ...metadata,
      reason: permission.reason,
      policyId: permission.policyId,
    })
    throw new Error(permission.reason)
  }
}

function recordIdentityAudit(
  security: SkillRepositoryIdentityWriteSecurity | undefined,
  action: "fs.read.outside-userdata" | "fs.write",
  resource: string,
  outcome: SkillRepositoryIdentityAuditOutcome,
  metadata: Record<string, unknown>,
): void {
  security?.auditSink.record({
    action,
    actor: security.actor,
    resource,
    outcome,
    metadata,
  })
}
