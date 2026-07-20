import { randomUUID } from "node:crypto"
import { constants, type BigIntStats } from "node:fs"
import { lstat, open, realpath, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
import { CONTENT_SKILL_IDENTITY_MAX_BYTES } from "../../config"
import { hasSameFileSnapshot, isFileNotFoundError, isPathInside, readFileHandleUpTo } from "./fs-utils"
import { SYNAPSE_SKILL_ID_FILE } from "./content-skill-source-service"

type ContentSkillIdentity = {
  id: string
  repositoryVersion: string
  sourceFingerprint: string
}

type ContentSkillIdentitySecurity = {
  actor: ActorIdentity
  auditSink: Pick<AuditSink, "record">
  permissionGuard: Pick<PermissionGuard, "check">
}

class ContentSkillIdentityChangedError extends Error {
  constructor() {
    super("本地 Skill 关联文件已变化，请重新检查后再试。")
    this.name = "ContentSkillIdentityChangedError"
  }
}

class ContentSkillIdentityTooLargeError extends Error {
  constructor() {
    super("本地 Skill 关联文件不能超过 64 KiB。")
    this.name = "ContentSkillIdentityTooLargeError"
  }
}

async function readContentSkillIdentityRaw(
  sourceDirectoryPath: string,
  security?: ContentSkillIdentitySecurity,
): Promise<string | null> {
  const targetPath = path.join(sourceDirectoryPath, SYNAPSE_SKILL_ID_FILE)
  const metadata = { operation: "content.skill.identity.read" }
  let expected: BigIntStats
  try {
    expected = await lstat(targetPath, { bigint: true })
  } catch (error) {
    if (isFileNotFoundError(error)) return null
    recordContentIdentityAudit(security, "fs.read.outside-userdata", targetPath, "failed", metadata)
    throw error
  }
  if (expected.isSymbolicLink()) {
    recordContentIdentityAudit(security, "fs.read.outside-userdata", targetPath, "failed", metadata)
    throw new Error("本地 Skill 关联文件不能是符号链接。")
  }
  if (!expected.isFile()) {
    recordContentIdentityAudit(security, "fs.read.outside-userdata", targetPath, "failed", metadata)
    throw new Error("本地 Skill 关联必须是普通文件。")
  }
  if (expected.size > BigInt(CONTENT_SKILL_IDENTITY_MAX_BYTES)) {
    recordContentIdentityAudit(security, "fs.read.outside-userdata", targetPath, "failed", {
      ...metadata,
      reason: "identity-too-large",
      maxBytes: CONTENT_SKILL_IDENTITY_MAX_BYTES,
    })
    throw new ContentSkillIdentityTooLargeError()
  }

  if (security) await checkContentIdentityReadPermission(security, targetPath, metadata)

  try {
    const raw = await readVerifiedContentIdentityFile(sourceDirectoryPath, targetPath, expected)
    recordContentIdentityAudit(security, "fs.read.outside-userdata", targetPath, "allowed", metadata)
    return raw
  } catch (error) {
    recordContentIdentityAudit(security, "fs.read.outside-userdata", targetPath, "failed", {
      ...metadata,
      ...(error instanceof ContentSkillIdentityTooLargeError
        ? { reason: "identity-too-large", maxBytes: CONTENT_SKILL_IDENTITY_MAX_BYTES }
        : {}),
    })
    throw error
  }
}

async function readVerifiedContentIdentityFile(
  sourceDirectoryPath: string,
  targetPath: string,
  expected: BigIntStats,
): Promise<string> {
  const [sourceRealPath, targetRealPath] = await Promise.all([
    realpath(sourceDirectoryPath),
    realpath(targetPath),
  ])
  if (!isPathInside(sourceRealPath, targetRealPath)) {
    throw new Error("本地 Skill 关联文件必须位于 Skill 目录内。")
  }

  const noFollowFlag = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
  const nonBlockingFlag = typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0
  const handle = await open(targetPath, constants.O_RDONLY | noFollowFlag | nonBlockingFlag)
  try {
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !hasSameFileSnapshot(expected, opened)) {
      throw new Error("本地 Skill 关联文件在读取前发生变化。")
    }
    const raw = await readBoundedContentIdentityFile(handle)
    const [afterRead, pathAfterRead, realPathAfterRead] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(targetPath, { bigint: true }),
      realpath(targetPath),
    ])
    if (
      pathAfterRead.isSymbolicLink()
      || !pathAfterRead.isFile()
      || !hasSameFileSnapshot(expected, afterRead)
      || !hasSameFileSnapshot(expected, pathAfterRead)
      || !isPathInside(sourceRealPath, realPathAfterRead)
    ) {
      throw new Error("本地 Skill 关联文件在读取期间发生变化。")
    }
    return raw
  } finally {
    await handle.close()
  }
}

async function readBoundedContentIdentityFile(handle: Awaited<ReturnType<typeof open>>): Promise<string> {
  const buffer = await readFileHandleUpTo(handle, CONTENT_SKILL_IDENTITY_MAX_BYTES + 1)
  if (buffer.byteLength > CONTENT_SKILL_IDENTITY_MAX_BYTES) throw new ContentSkillIdentityTooLargeError()
  return buffer.toString("utf8")
}

async function checkContentIdentityReadPermission(
  security: ContentSkillIdentitySecurity,
  resource: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const permission = await security.permissionGuard.check({
    action: "fs.read.outside-userdata",
    actor: security.actor,
    context: metadata,
    resource,
  })
  if (!permission.allowed) {
    recordContentIdentityAudit(security, "fs.read.outside-userdata", resource, "denied", {
      ...metadata,
      policyId: permission.policyId,
      reason: permission.reason,
    })
    throw new Error(permission.reason)
  }
}

function recordContentIdentityAudit(
  security: ContentSkillIdentitySecurity | undefined,
  action: "fs.read.outside-userdata" | "fs.write",
  resource: string,
  outcome: "allowed" | "denied" | "failed",
  metadata: Record<string, unknown>,
): void {
  security?.auditSink.record({
    action,
    actor: security.actor,
    metadata,
    outcome,
    resource,
  })
}

async function writeContentSkillIdentity(
  sourceDirectoryPath: string,
  identity: ContentSkillIdentity,
  expectedRaw: string | null,
  security?: ContentSkillIdentitySecurity,
): Promise<void> {
  const targetPath = path.join(sourceDirectoryPath, SYNAPSE_SKILL_ID_FILE)
  const tempPath = path.join(sourceDirectoryPath, `${SYNAPSE_SKILL_ID_FILE}.${randomUUID()}.tmp`)
  const metadata = {
    contentId: identity.id,
    operation: "content.skill.identity.write",
    repositoryVersion: identity.repositoryVersion,
  }

  if (security) {
    const permission = await security.permissionGuard.check({
      action: "fs.write",
      actor: security.actor,
      context: metadata,
      resource: targetPath,
    })
    if (!permission.allowed) {
      security.auditSink.record({
        action: "fs.write",
        actor: security.actor,
        metadata: { ...metadata, policyId: permission.policyId, reason: permission.reason },
        outcome: "denied",
        resource: targetPath,
      })
      throw new Error(permission.reason)
    }
  }

  try {
    await writeFile(tempPath, `${JSON.stringify(identity, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
    const currentRaw = await readContentSkillIdentityRaw(sourceDirectoryPath, security)
    if (currentRaw !== expectedRaw) {
      throw new ContentSkillIdentityChangedError()
    }
    await rename(tempPath, targetPath)
    security?.auditSink.record({
      action: "fs.write",
      actor: security.actor,
      metadata,
      outcome: "allowed",
      resource: targetPath,
    })
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    security?.auditSink.record({
      action: "fs.write",
      actor: security.actor,
      metadata,
      outcome: "failed",
      resource: targetPath,
    })
    throw error
  }
}

export {
  ContentSkillIdentityChangedError,
  readContentSkillIdentityRaw,
  writeContentSkillIdentity,
  type ContentSkillIdentity,
  type ContentSkillIdentitySecurity,
}
