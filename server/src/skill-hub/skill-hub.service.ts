import { Inject, Injectable } from "@nestjs/common"
import { Prisma, type SkillHubWriteReceipt as ReceiptRow } from "@prisma/client"
import {
  SKILL_HUB_LIMITS as limits, skillHubIdSchema, skillHubReceiptResultSchema,
  type SkillHubCreateInput, type SkillHubDeleteResult, type SkillHubDetail, type SkillHubListInput,
  type SkillHubPage, type SkillHubPublishInput, type SkillHubReceipt, type SkillHubReceiptInput,
  type SkillHubReceiptResult, type SkillHubRevisionInput, type SkillHubUpdateInput,
  type SkillHubWriteAction, type SkillHubWriteReplay, type SkillHubWriteResult,
} from "@synapse/shared/skill-hub-contracts"
import { decodeUtf8 } from "@synapse/shared/archive-package-node"
import { z } from "zod"
import { hubPageLimit, SkillHubRepository } from "./skill-hub.repository"
import { decodeHubCursor, encodeHubCursor } from "./skill-hub-cursor"
import { hubError } from "./skill-hub-error"
import { consumeVerifiedHubObject, openSkillHubObject } from "./skill-hub-object-read"
import { SKILL_HUB_STORAGE, type SkillHubStoragePort } from "./skill-hub-storage"
import { hubDetail, hubDetailSelect, hubMaintainers, hubSummary, hubSummarySelect, hubUnavailable, readableHubSkills } from "./skill-hub-read"
import {
  bindHubUpload, checkHubRevision, checkHubVersion, findHubReceipt, getHubUpload, hubInputDigest,
  hubUploadObject, hubVersionData, lockHubRequest, lockHubSkill,
} from "./skill-hub-write"

const catalogCursor = {
  parse(value: unknown) {
    const [publishedAt, id] = z.tuple([z.iso.datetime(), z.string()]).parse(value)
    return { publishedAt: new Date(publishedAt), id: skillHubIdSchema.parse(id) }
  },
}
const readIsolation = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
const storageUnavailable = () => hubError(503, "HUB_STORAGE_UNAVAILABLE", "Skill 文件暂不可用，请稍后重试。")

@Injectable()
export class SkillHubService {
  constructor(
    private readonly repository: SkillHubRepository,
    @Inject(SKILL_HUB_STORAGE) private readonly storage: SkillHubStoragePort,
  ) {}

  async list(userId: string, input: SkillHubListInput): Promise<SkillHubPage> {
    const query = input.query?.trim() || ""
    const scope = `catalog:${hubInputDigest([userId, input.teamId, !!input.createdByMe, query])}`
    const after = input.cursor ? decodeHubCursor(scope, input.cursor, catalogCursor) : undefined
    const limit = hubPageLimit(input.limit)
    return this.repository.prisma.$transaction(async (tx) => {
      const search = { contains: query.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" as const }
      const rows = await tx.skillHubSkill.findMany({
        where: {
          ...readableHubSkills(userId),
          ...(input.teamId ? { teamId: input.teamId } : {}),
          ...(input.createdByMe ? { createdById: userId } : {}),
          AND: [
            ...(query ? [{ OR: [{ displayName: search }, { displayDescription: search }] }] : []),
            ...(after ? [{ OR: [
              { publishedAt: { lt: after.publishedAt } },
              { publishedAt: after.publishedAt, id: { lt: after.id } },
            ] }] : []),
          ],
        },
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }], take: limit + 1, select: hubSummarySelect,
      })
      const page = rows.slice(0, limit)
      const active = await hubMaintainers(tx, page)
      const last = page.at(-1)
      return {
        items: page.map((row) => hubSummary(row, userId, active(row))),
        nextCursor: rows.length > limit && last ? encodeHubCursor(scope, [last.publishedAt.toISOString(), last.id]) : null,
      }
    }, readIsolation)
  }

  async get(userId: string, skillId: string): Promise<SkillHubDetail> {
    return this.repository.prisma.$transaction((tx) => this.readDetail(tx, userId, skillId), readIsolation)
  }

  async create(userId: string, input: SkillHubCreateInput): Promise<SkillHubWriteResult | SkillHubWriteReplay> {
    return this.write(userId, "app.skill_hub.skill.create", input.requestId,
      [input.teamId, input.packageUploadId, input.iconUploadId, input.displayName, input.displayDescription],
      async (tx) => {
        const actor = await this.repository.lockActiveTeamMember(tx, input.teamId, userId)
        const now = new Date()
        const pkg = await getHubUpload(tx, userId, input.teamId, input.packageUploadId, "package", now)
        const icon = input.iconUploadId ? await getHubUpload(tx, userId, input.teamId, input.iconUploadId, "icon", now) : null
        await bindHubUpload(tx, pkg, now)
        if (icon) await bindHubUpload(tx, icon, now)
        const asset = await tx.skillHubSkill.create({
          data: {
            teamId: input.teamId, createdById: actor.id, createdByName: actor.nickname,
            maintainerUserId: actor.id, maintainerName: actor.nickname,
            displayName: input.displayName, displayDescription: input.displayDescription,
            iconObjectId: icon ? hubUploadObject(icon, "icon").id : null, publishedAt: now,
          },
          select: { id: true },
        })
        const version = await tx.skillHubVersion.create({ data: hubVersionData(pkg, asset.id, 1), select: { id: true } })
        await tx.skillHubSkill.update({ where: { id: asset.id }, data: { currentVersionId: version.id } })
        const skill = await this.readDetail(tx, userId, asset.id)
        return this.writeOutcome(skill, "created", pkg.contentFingerprint, icon?.inputSha256)
      })
  }

  async publish(userId: string, skillId: string, input: SkillHubPublishInput): Promise<SkillHubWriteResult | SkillHubWriteReplay> {
    return this.write(userId, "app.skill_hub.version.create", input.requestId,
      [skillId, input.expectedVersionId, input.packageUploadId],
      async (tx) => {
        const current = await this.maintain(tx, userId, skillId)
        const version = current.currentVersion!
        checkHubVersion(input.expectedVersionId, version.id)
        const now = new Date()
        const pkg = await getHubUpload(tx, userId, current.teamId, input.packageUploadId, "package", now)
        if (pkg.contentFingerprint === version.contentFingerprint) {
          await tx.skillHubUpload.updateMany({ where: { id: pkg.id, state: "ready" }, data: { state: "cleanup" } })
          return this.writeOutcome(hubDetail(current, userId, true), "unchanged", pkg.contentFingerprint)
        }
        await bindHubUpload(tx, pkg, now)
        const newVersion = await tx.skillHubVersion.create({
          data: hubVersionData(pkg, skillId, version.number + 1), select: { id: true },
        })
        await tx.skillHubSkill.update({
          where: { id: skillId }, data: { currentVersionId: newVersion.id, revision: { increment: 1 }, publishedAt: now },
        })
        return this.writeOutcome(await this.readDetail(tx, userId, skillId), "published", pkg.contentFingerprint)
      })
  }

  async update(userId: string, skillId: string, input: SkillHubUpdateInput): Promise<SkillHubWriteResult | SkillHubWriteReplay> {
    return this.write(userId, "app.skill_hub.skill.update", input.requestId,
      [skillId, input.expectedRevision, input.displayName, input.displayDescription,
        input.iconUploadId === undefined ? "keep" : input.iconUploadId],
      async (tx) => {
        const current = await this.maintain(tx, userId, skillId)
        checkHubRevision(input.expectedRevision, current.revision)
        const now = new Date()
        const icon = input.iconUploadId ? await getHubUpload(tx, userId, current.teamId, input.iconUploadId, "icon", now) : null
        if (icon) await bindHubUpload(tx, icon, now)
        await tx.skillHubSkill.update({
          where: { id: skillId },
          data: {
            displayName: input.displayName, displayDescription: input.displayDescription,
            ...(input.iconUploadId !== undefined ? { iconObjectId: icon ? hubUploadObject(icon, "icon").id : null } : {}),
            revision: { increment: 1 },
          },
        })
        if (input.iconUploadId !== undefined && current.iconObjectId) {
          await tx.skillHubObject.update({ where: { id: current.iconObjectId }, data: { state: "deletePending" } })
        }
        return this.writeOutcome(await this.readDetail(tx, userId, skillId), "updated", undefined, icon?.inputSha256)
      })
  }

  async softDelete(userId: string, skillId: string, input: SkillHubRevisionInput): Promise<SkillHubDeleteResult | SkillHubWriteReplay> {
    return this.write(userId, "app.skill_hub.skill.delete", input.requestId, [skillId, input.expectedRevision], async (tx) => {
      const current = await this.maintain(tx, userId, skillId)
      checkHubRevision(input.expectedRevision, current.revision)
      const now = new Date()
      const { revision } = await tx.skillHubSkill.update({
        where: { id: skillId },
        data: { deletedAt: now, deletedById: userId, revision: { increment: 1 } },
        select: { revision: true },
      })
      const result: SkillHubDeleteResult = { id: skillId, revision, deletedAt: now.toISOString(), outcome: "deleted" }
      const receipt: SkillHubReceiptResult = {
        skillId, teamId: current.teamId, versionId: current.currentVersion!.id,
        versionNumber: current.currentVersion!.number, revision, outcome: "deleted",
      }
      return { result, receipt, payloadDigest: "" }
    })
  }

  async getReceipt(userId: string, input: SkillHubReceiptInput): Promise<SkillHubReceipt> {
    return this.repository.prisma.$transaction(async (tx) => {
      const row = await findHubReceipt(tx, { actorKey: userId, ...input })
      return row ? this.receiptFor(tx, userId, input.action, row) : { ...input, status: "not_found", resultAccessible: false }
    }, readIsolation)
  }

  async openLatest(userId: string, skillId: string, expectedVersionId?: string) {
    const row = await this.latest(userId, skillId, expectedVersionId)
    const version = row.currentVersion!
    const response = await openSkillHubObject(this.storage, version.archiveObject, limits.uploadBytes).catch(() => { throw storageUnavailable() })
    return { ...response, versionId: version.id, sha256: version.archiveObject.sha256 }
  }

  async openMain(userId: string, skillId: string, expectedVersionId?: string) {
    const row = await this.latest(userId, skillId, expectedVersionId)
    const version = row.currentVersion!
    const chunks: Buffer[] = []
    try {
      await consumeVerifiedHubObject(this.storage, version.mainObject, limits.mainBytes, (chunk) => chunks.push(chunk))
      return { content: decodeUtf8(Buffer.concat(chunks)), versionId: version.id }
    } catch {
      throw storageUnavailable()
    }
  }

  async openIcon(userId: string, skillId: string) {
    const row = await this.latest(userId, skillId)
    if (!row.iconObject) throw hubUnavailable()
    const response = await openSkillHubObject(this.storage, row.iconObject, limits.iconBytes).catch(() => { throw storageUnavailable() })
    return { ...response, contentType: "image/png" as const }
  }

  private async latest(userId: string, id: string, expectedVersionId?: string) {
    return this.repository.prisma.$transaction(async (tx) => {
      const row = await tx.skillHubSkill.findFirst({ where: { id, ...readableHubSkills(userId) }, select: hubDetailSelect })
      if (!row?.currentVersion) throw hubUnavailable()
      if (expectedVersionId && expectedVersionId !== row.currentVersion.id) {
        throw hubError(409, "HUB_LATEST_CHANGED", "最新版已变化，请重新读取后再试。")
      }
      return row
    }, readIsolation)
  }

  private async readDetail(tx: Prisma.TransactionClient, userId: string, id: string) {
    const row = await tx.skillHubSkill.findFirst({ where: { id, ...readableHubSkills(userId) }, select: hubDetailSelect })
    if (!row?.currentVersion) throw hubUnavailable()
    const active = await hubMaintainers(tx, [row])
    return hubDetail(row, userId, active(row))
  }

  private async maintain(tx: Prisma.TransactionClient, userId: string, id: string) {
    const locator = await tx.skillHubSkill.findFirst({ where: { id, ...readableHubSkills(userId) }, select: { teamId: true } })
    if (!locator) throw hubUnavailable()
    await this.repository.lockActiveTeamMember(tx, locator.teamId, userId)
    await lockHubSkill(tx, locator.teamId, id)
    const current = await tx.skillHubSkill.findFirst({ where: { id, deletedAt: null, maintainerUserId: userId }, select: hubDetailSelect })
    if (!current?.currentVersion) throw hubUnavailable()
    return current
  }

  private async receiptFor(tx: Prisma.TransactionClient, userId: string, action: SkillHubWriteAction, row: ReceiptRow): Promise<SkillHubReceipt> {
    const hasAccess = Boolean(await tx.skillHubSkill.findFirst({
      where: { id: row.skillId, ...readableHubSkills(userId) }, select: { id: true },
    }))
    return {
      action, requestId: row.requestId, status: "committed", resultAccessible: hasAccess,
      ...(hasAccess ? { result: skillHubReceiptResultSchema.parse(row.result) } : {}),
    }
  }

  private writeOutcome(skill: SkillHubDetail, outcome: SkillHubWriteResult["outcome"], packageDigest?: string | null, iconDigest?: string) {
    const result: SkillHubWriteResult = { skill, outcome }
    const receipt: SkillHubReceiptResult = {
      skillId: skill.id, teamId: skill.team.id, versionId: skill.currentVersion.id,
      versionNumber: skill.currentVersion.number, revision: skill.revision, outcome,
    }
    return { result, receipt, payloadDigest: hubInputDigest([packageDigest, iconDigest]) }
  }

  private async write<T>(
    actorKey: string, action: SkillHubWriteAction, requestId: string, fields: readonly unknown[],
    commit: (tx: Prisma.TransactionClient) => Promise<{ result: T; receipt: SkillHubReceiptResult; payloadDigest: string }>,
  ): Promise<T | SkillHubWriteReplay> {
    const key = { actorKey, action, requestId }
    const inputDigest = hubInputDigest(fields)
    return this.repository.prisma.$transaction(async (tx) => {
      await lockHubRequest(tx, key)
      const previous = await findHubReceipt(tx, key, inputDigest)
      if (previous) return { replayed: true, receipt: await this.receiptFor(tx, actorKey, action, previous) }
      const { result, receipt, payloadDigest } = await commit(tx)
      await tx.skillHubWriteReceipt.create({
        data: { ...key, requestDigest: `${inputDigest}:${payloadDigest}`, skillId: receipt.skillId, versionId: receipt.versionId, result: receipt },
      })
      return result
    })
  }
}
