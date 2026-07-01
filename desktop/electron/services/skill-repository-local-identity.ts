import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
import { SYNAPSE_SKILL_ID_FILE_NAME } from "./editor-adapters/skill-identity"
import { isFileNotFoundError } from "./fs-utils"

const sharedSkillRepositoryPromise = import("@synapse/shared")

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

type SkillRepositoryIdentityAuditOutcome = "allowed" | "denied" | "failed"

export async function writeSkillRepositoryIdentity(
  sourceDirectoryPath: string,
  identity: SkillRepositoryIdentity,
  security?: SkillRepositoryIdentityWriteSecurity,
): Promise<void> {
  const targetPath = path.join(sourceDirectoryPath, SYNAPSE_SKILL_ID_FILE_NAME)
  let tempPath: string | null = null
  const metadata = {
    operation: "skill-repository.identity.write",
    repositoryId: identity.id,
    repositoryName: identity.name,
  }

  if (security) {
    const permission = await security.permissionGuard.check({
      action: "fs.write",
      actor: security.actor,
      resource: targetPath,
      context: metadata,
    })
    if (!permission.allowed) {
      recordIdentityAudit(security, targetPath, "denied", {
        ...metadata,
        reason: permission.reason,
        policyId: permission.policyId,
      })
      throw new Error(permission.reason)
    }
  }

  try {
    await mkdir(sourceDirectoryPath, { recursive: true })
    tempPath = path.join(sourceDirectoryPath, `${SYNAPSE_SKILL_ID_FILE_NAME}.${randomUUID()}.tmp`)
    await writeFile(tempPath, `${JSON.stringify(identity, null, 2)}\n`, "utf8")
    await rename(tempPath, targetPath)
    tempPath = null
    recordIdentityAudit(security, targetPath, "allowed", metadata)
  } catch (error) {
    if (tempPath) {
      await rm(tempPath, { force: true }).catch(() => undefined)
    }
    recordIdentityAudit(security, targetPath, "failed", metadata)
    throw error
  }
}

export async function readSkillRepositoryIdentity(sourceDirectoryPath: string): Promise<SkillRepositoryIdentity | null> {
  let raw: string
  try {
    raw = await readFile(path.join(sourceDirectoryPath, SYNAPSE_SKILL_ID_FILE_NAME), "utf8")
  } catch (error) {
    if (isFileNotFoundError(error)) return null
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== "object") return null
  const candidate = parsed as Record<string, unknown>
  if (candidate.kind !== "cloud-skill-repository") return null
  if (typeof candidate.id !== "string" || !candidate.id.trim()) return null
  if (typeof candidate.name !== "string" || !candidate.name.trim()) return null

  const { normalizeSkillRepositoryName } = await sharedSkillRepositoryPromise
  let name: string
  try {
    name = normalizeSkillRepositoryName(candidate.name)
  } catch {
    return null
  }

  return {
    id: candidate.id.trim(),
    kind: "cloud-skill-repository",
    owner: typeof candidate.owner === "string" && candidate.owner.trim() ? candidate.owner.trim() : null,
    name,
  }
}

function recordIdentityAudit(
  security: SkillRepositoryIdentityWriteSecurity | undefined,
  resource: string,
  outcome: SkillRepositoryIdentityAuditOutcome,
  metadata: Record<string, unknown>,
): void {
  security?.auditSink.record({
    action: "fs.write",
    actor: security.actor,
    resource,
    outcome,
    metadata,
  })
}
