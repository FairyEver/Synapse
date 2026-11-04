import { createHash } from "node:crypto"
import type { Prisma, SkillHubObjectKind } from "@prisma/client"
import { skillHubManifestSchema, skillHubPackageInfoSchema } from "@synapse/shared/skill-hub-contracts"
import { hubError } from "./skill-hub-error"
import { hubUnavailable } from "./skill-hub-read"

export type HubWriteKey = { actorKey: string; action: string; requestId: string }

export function hubInputDigest(fields: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex")
}

export async function lockHubRequest(tx: Prisma.TransactionClient, key: HubWriteKey) {
  const scope = JSON.stringify(["skill-hub-write", key.actorKey, key.action, key.requestId])
  // Use executeRaw rather than deserializing PostgreSQL's void return type.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))`
}

export async function findHubReceipt(tx: Prisma.TransactionClient, key: HubWriteKey, inputDigest?: string) {
  const record = await tx.skillHubWriteReceipt.findUnique({ where: { actorKey_action_requestId: key } })
  if (record && inputDigest !== undefined && record.requestDigest.split(":", 1)[0] !== inputDigest) {
    throw hubError(409, "HUB_REQUEST_CONFLICT", "此请求标识已用于另一项操作。")
  }
  return record
}

export async function lockHubSkill(tx: Prisma.TransactionClient, teamId: string, skillId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "SkillHubSkill" WHERE "id" = ${skillId} AND "teamId" = ${teamId} FOR UPDATE
  `
  if (!rows.length) throw hubUnavailable()
}

export function checkHubRevision(expected: number, actual: number): void {
  if (expected !== actual) throw hubError(409, "HUB_REVISION_CONFLICT", "Skill 资料已变化，请重新读取后再操作。")
}

export function checkHubVersion(expected: string, actual: string): void {
  if (expected !== actual) throw hubError(409, "HUB_VERSION_CONFLICT", "Skill 版本已变化，请重新读取当前版本。")
}

const uploadUnavailable = () => hubError(409, "HUB_UPLOAD_UNAVAILABLE", "上传不存在、已使用或已过期，请重新准备文件。")

export async function getHubUpload(
  tx: Prisma.TransactionClient, userId: string, teamId: string, id: string, purpose: "package" | "icon", now: Date,
) {
  const upload = await tx.skillHubUpload.findFirst({
    where: { id, actorKey: userId, teamId, purpose, state: "ready", expiresAt: { gt: now } },
    include: { objects: true },
  })
  if (!upload) throw uploadUnavailable()
  return upload
}

type ReadyUpload = Awaited<ReturnType<typeof getHubUpload>>

export async function bindHubUpload(tx: Prisma.TransactionClient, upload: ReadyUpload, now: Date): Promise<void> {
  const update = await tx.skillHubUpload.updateMany({
    where: { id: upload.id, state: "ready", expiresAt: { gt: now } }, data: { state: "bound" },
  })
  if (update.count !== 1) throw uploadUnavailable()
}

export function hubUploadObject(upload: ReadyUpload, kind: SkillHubObjectKind) {
  const object = upload.objects.find((item) => item.kind === kind && item.state === "ready")
  if (!object) throw uploadUnavailable()
  return object
}

export function hubVersionData(upload: ReadyUpload, skillId: string, number: number): Prisma.SkillHubVersionUncheckedCreateInput {
  const info = skillHubPackageInfoSchema.parse({ name: upload.packageName, description: upload.packageDescription })
  if (!upload.contentFingerprint) throw uploadUnavailable()
  return {
    skillId, number, packageName: info.name, packageDescription: info.description,
    manifest: skillHubManifestSchema.parse(upload.manifest),
    contentFingerprint: upload.contentFingerprint,
    archiveObjectId: hubUploadObject(upload, "archive").id,
    mainObjectId: hubUploadObject(upload, "main").id,
  }
}
