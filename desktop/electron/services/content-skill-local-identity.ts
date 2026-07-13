import { randomUUID } from "node:crypto"
import { readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
import { isFileNotFoundError } from "./fs-utils"
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

async function readContentSkillIdentityRaw(sourceDirectoryPath: string): Promise<string | null> {
  try {
    return await readFile(path.join(sourceDirectoryPath, SYNAPSE_SKILL_ID_FILE), "utf8")
  } catch (error) {
    if (isFileNotFoundError(error)) return null
    throw error
  }
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
    const currentRaw = await readContentSkillIdentityRaw(sourceDirectoryPath)
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
