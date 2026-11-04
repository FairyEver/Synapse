import { HttpException, Inject, Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import {
  SKILL_HUB_LIMITS as limits, skillHubAdminRowSchema, skillHubIdSchema,
  type SkillHubAdminListInput, type SkillHubAdminPage, type SkillHubAdminRow,
  type SkillHubAssignMaintainerInput, type SkillHubRevisionInput,
} from "@synapse/shared/skill-hub-contracts"
import { auditActors, AuditLogService } from "../common/audit-log.service"
import { withTeamResourceLock } from "../team/team-resource-lock"
import { decodeHubCursor, encodeHubCursor } from "./skill-hub-cursor"
import { hubError } from "./skill-hub-error"
import { verifySkillHubObject } from "./skill-hub-object-read"
import { hubAdminRow, hubAdminSelect, hubDetailSelect, hubMaintainers, hubUnavailable } from "./skill-hub-read"
import { SKILL_HUB_STORAGE, type SkillHubStoragePort } from "./skill-hub-storage"
import { checkHubRevision, findHubReceipt, hubInputDigest, lockHubRequest, lockHubSkill, type HubWriteKey } from "./skill-hub-write"
import { hubPageLimit, SkillHubRepository } from "./skill-hub.repository"

type AdminActor = { sessionId: string; ip: string }
type AdminWrite = "maintainer" | "restore"
const restoreMissing = () => hubError(409, "HUB_RESTORE_INCOMPLETE", "无法确认 Skill 文件完整，条目仍保留为已删除。")

@Injectable()
export class SkillHubAdminService {
  constructor(
    private readonly repository: SkillHubRepository,
    private readonly audit: AuditLogService,
    @Inject(SKILL_HUB_STORAGE) private readonly storage: SkillHubStoragePort,
  ) {}

  async list(actor: AdminActor, input: SkillHubAdminListInput): Promise<SkillHubAdminPage> {
    const scope = `admin:${hubInputDigest([actor.sessionId, input.teamId, input.deleted])}`
    const after = input.cursor ? decodeHubCursor(scope, input.cursor, skillHubIdSchema) : undefined
    const limit = hubPageLimit(input.limit)
    const result = await this.repository.prisma.$transaction(async (tx) => {
      const rows = await tx.skillHubSkill.findMany({
        where: {
          teamId: input.teamId, currentVersionId: { not: null },
          ...(input.deleted !== undefined ? { deletedAt: input.deleted ? { not: null } : null } : {}),
          ...(after ? { id: { gt: after } } : {}),
        },
        select: hubAdminSelect, orderBy: { id: "asc" }, take: limit + 1,
      })
      const page = rows.slice(0, limit)
      const active = await hubMaintainers(tx, page)
      return {
        items: page.map((row) => hubAdminRow(row, active(row))),
        nextCursor: rows.length > limit ? encodeHubCursor(scope, page[page.length - 1].id) : null,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
    await this.audit.record({
      actor: auditActors.platformAdmin(actor.sessionId), action: "admin.skill_hub.list",
      targetType: "team", targetId: input.teamId, ipAddress: actor.ip,
      detail: { returned: result.items.length, deleted: input.deleted ?? null },
    })
    return result
  }

  async assignMaintainer(actor: AdminActor, skillId: string, input: SkillHubAssignMaintainerInput): Promise<SkillHubAdminRow> {
    return this.write(actor, "maintainer", skillId, input, [input.maintainerUserId], async (tx, teamId) => {
      let member
      try {
        member = await this.repository.lockActiveTeamMember(tx, teamId, input.maintainerUserId)
      } catch (error) {
        if (error instanceof HttpException && error.getStatus() === 403) {
          throw hubError(400, "HUB_MAINTAINER_UNAVAILABLE", "请选择此团队的有效成员。")
        }
        throw error
      }
      await lockHubSkill(tx, teamId, skillId)
      const current = await tx.skillHubSkill.findUniqueOrThrow({ where: { id: skillId }, select: { revision: true } })
      checkHubRevision(input.expectedRevision, current.revision)
      return { maintainerUserId: member.id, maintainerName: member.nickname, revision: { increment: 1 } }
    })
  }

  async restore(actor: AdminActor, skillId: string, input: SkillHubRevisionInput): Promise<SkillHubAdminRow> {
    const key = this.key(actor, "restore", input.requestId)
    const digest = hubInputDigest([skillId, input.expectedRevision])
    const db = this.repository.prisma
    const replay = await findHubReceipt(db, key, digest)
    if (replay) return skillHubAdminRowSchema.parse(replay.result)

    const snapshot = await db.skillHubSkill.findUnique({ where: { id: skillId }, select: hubDetailSelect })
    if (!snapshot) throw hubUnavailable()
    if (snapshot.deletedAt && snapshot.revision === input.expectedRevision) {
      try {
        const version = snapshot.currentVersion
        if (!version || version.archiveObject.state !== "ready" || version.mainObject.state !== "ready"
          || (snapshot.iconObject && snapshot.iconObject.state !== "ready")) throw restoreMissing()
        await Promise.all([
          verifySkillHubObject(this.storage, version.archiveObject, limits.uploadBytes),
          verifySkillHubObject(this.storage, version.mainObject, limits.mainBytes),
          ...(snapshot.iconObject ? [verifySkillHubObject(this.storage, snapshot.iconObject, limits.iconBytes)] : []),
        ])
      } catch {
        const committed = await findHubReceipt(db, key, digest)
        if (committed) return skillHubAdminRowSchema.parse(committed.result)
        throw restoreMissing()
      }
    }

    return this.write(actor, "restore", skillId, input, [], async (tx, teamId) => {
      if (!await withTeamResourceLock(tx, teamId)) throw hubUnavailable()
      await lockHubSkill(tx, teamId, skillId)
      const current = await tx.skillHubSkill.findUniqueOrThrow({
        where: { id: skillId }, select: { revision: true, deletedAt: true, currentVersionId: true, iconObjectId: true },
      })
      checkHubRevision(input.expectedRevision, current.revision)
      if (!current.deletedAt) throw hubError(409, "HUB_NOT_DELETED", "此 Skill 当前未删除。")
      if (!snapshot.deletedAt || !snapshot.currentVersion || snapshot.revision !== current.revision
        || snapshot.currentVersion.id !== current.currentVersionId || snapshot.iconObjectId !== current.iconObjectId) {
        throw restoreMissing()
      }
      return { deletedAt: null, deletedById: null, revision: { increment: 1 } }
    })
  }

  private key(actor: AdminActor, operation: AdminWrite, requestId: string): HubWriteKey {
    return { actorKey: `platform-admin:${actor.sessionId}`, action: `admin.skill_hub.${operation}`, requestId }
  }

  private async write(
    actor: AdminActor, operation: AdminWrite, skillId: string, input: SkillHubRevisionInput, fields: unknown[],
    dataFor: (tx: Prisma.TransactionClient, teamId: string) => Promise<Prisma.SkillHubSkillUncheckedUpdateInput>,
  ) {
    const key = this.key(actor, operation, input.requestId)
    const digest = hubInputDigest([skillId, input.expectedRevision, ...fields])
    return this.repository.prisma.$transaction(async (tx) => {
      await lockHubRequest(tx, key)
      const prior = await findHubReceipt(tx, key, digest)
      if (prior) return skillHubAdminRowSchema.parse(prior.result)
      const skill = await tx.skillHubSkill.findUnique({ where: { id: skillId }, select: { teamId: true } })
      if (!skill) throw hubUnavailable()
      const data = await dataFor(tx, skill.teamId)
      const row = await tx.skillHubSkill.update({ where: { id: skillId }, data, select: hubAdminSelect })
      const active = await hubMaintainers(tx, [row])
      const result = hubAdminRow(row, active(row))
      await this.audit.recordWithClient(tx, {
        actor: auditActors.platformAdmin(actor.sessionId), action: key.action, ipAddress: actor.ip,
        targetType: "skill_hub_skill", targetId: skillId,
        detail: { teamId: skill.teamId, revision: row.revision, maintainerUserId: row.maintainerUserId },
      })
      await tx.skillHubWriteReceipt.create({
        data: { ...key, requestDigest: digest, skillId, result },
      })
      return result
    })
  }
}
