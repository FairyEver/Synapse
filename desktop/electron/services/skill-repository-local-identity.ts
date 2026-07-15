import { randomUUID } from "node:crypto"
import { constants, type BigIntStats } from "node:fs"
import { lstat, mkdir, open, realpath, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
import { isFileNotFoundError } from "./fs-utils"

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

type SkillRepositoryIdentityAuditOutcome = "allowed" | "denied" | "failed"

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
  security?: SkillRepositoryIdentityWriteSecurity,
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
    await mkdir(sourceDirectoryPath, { recursive: true })
    tempPath = path.join(sourceDirectoryPath, `${SKILL_REPOSITORY_ID_FILE_NAME}.${randomUUID()}.tmp`)
    await writeFile(tempPath, `${JSON.stringify(identity, null, 2)}\n`, "utf8")
    await rename(tempPath, targetPath)
    tempPath = null
    recordIdentityAudit(security, "fs.write", targetPath, "allowed", metadata)
  } catch (error) {
    if (tempPath) {
      await rm(tempPath, { force: true }).catch(() => undefined)
    }
    recordIdentityAudit(security, "fs.write", targetPath, "failed", metadata)
    throw error
  }
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
  const legacyIdentity = await readIdentityFile(
    sourceDirectoryPath,
    LEGACY_SKILL_REPOSITORY_ID_FILE_NAME,
    "legacy",
    security,
  )
  if (!legacyIdentity) return false

  const metadata = {
    operation: "skill-repository.identity.migrate",
    repositoryId: legacyIdentity.id,
  }
  if (security) await checkIdentityWritePermission(security, legacyPath, metadata)

  try {
    await rm(legacyPath)
    recordIdentityAudit(security, "fs.write", legacyPath, "allowed", metadata)
    return true
  } catch (error) {
    recordIdentityAudit(security, "fs.write", legacyPath, "failed", metadata)
    throw error
  }
}

async function readIdentityFile(
  sourceDirectoryPath: string,
  fileName: string,
  identitySource: "current" | "legacy",
  security?: SkillRepositoryIdentityReadSecurity,
): Promise<SkillRepositoryIdentity | null> {
  const filePath = path.join(sourceDirectoryPath, fileName)
  const metadata = {
    operation: "skill-repository.identity.read",
    identitySource,
  }
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

  if (security) await checkIdentityReadPermission(security, filePath, metadata)

  let raw: string
  try {
    raw = await readVerifiedIdentityFile(sourceDirectoryPath, filePath, expected)
  } catch (error) {
    recordIdentityAudit(security, "fs.read.outside-userdata", filePath, "failed", metadata)
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    recordIdentityAudit(security, "fs.read.outside-userdata", filePath, "allowed", {
      ...metadata,
      identityFound: false,
    })
    return null
  }

  if (!parsed || typeof parsed !== "object") {
    recordIdentityAudit(security, "fs.read.outside-userdata", filePath, "allowed", {
      ...metadata,
      identityFound: false,
    })
    return null
  }
  const candidate = parsed as Record<string, unknown>
  if (
    candidate.kind !== "cloud-skill-repository"
    || typeof candidate.id !== "string"
    || !candidate.id.trim()
    || typeof candidate.name !== "string"
    || !candidate.name.trim()
  ) {
    recordIdentityAudit(security, "fs.read.outside-userdata", filePath, "allowed", {
      ...metadata,
      identityFound: false,
    })
    return null
  }

  const { normalizeSkillRepositoryName } = await sharedSkillRepositoryPromise
  let name: string
  try {
    name = normalizeSkillRepositoryName(candidate.name)
  } catch {
    recordIdentityAudit(security, "fs.read.outside-userdata", filePath, "allowed", {
      ...metadata,
      identityFound: false,
    })
    return null
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
  return identity
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
    if (!opened.isFile() || !sameFileSnapshot(expected, opened)) {
      throw new Error("Skill 云仓库身份文件在读取前发生变化。")
    }
    const raw = await handle.readFile({ encoding: "utf8" })
    const [afterRead, pathAfterRead, realPathAfterRead] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(filePath, { bigint: true }),
      realpath(filePath),
    ])
    if (
      pathAfterRead.isSymbolicLink()
      || !pathAfterRead.isFile()
      || !sameFileSnapshot(expected, afterRead)
      || !sameFileSnapshot(expected, pathAfterRead)
      || !isPathInside(sourceRealPath, realPathAfterRead)
    ) {
      throw new Error("Skill 云仓库身份文件在读取期间发生变化。")
    }
    return raw
  } finally {
    await handle.close()
  }
}

function sameFileSnapshot(expected: BigIntStats, actual: BigIntStats): boolean {
  return expected.dev === actual.dev
    && expected.ino === actual.ino
    && expected.mode === actual.mode
    && expected.size === actual.size
    && expected.mtimeNs === actual.mtimeNs
    && expected.ctimeNs === actual.ctimeNs
}

function isPathInside(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
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
