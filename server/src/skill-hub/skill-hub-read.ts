import { Prisma } from "@prisma/client"
import {
  skillHubManifestSchema,
  type SkillHubAdminRow, type SkillHubDetail, type SkillHubSummary,
} from "@synapse/shared/skill-hub-contracts"
import { hubError } from "./skill-hub-error"

const objectMeta = { select: { storageKey: true, size: true, sha256: true, state: true } } as const
const versionBase = {
  id: true, number: true, packageName: true, contentFingerprint: true, archiveObject: objectMeta,
} as const
const skillBase = {
  id: true, teamId: true, team: { select: { id: true, name: true } }, displayName: true, displayDescription: true,
  iconObjectId: true, revision: true, createdById: true, createdByName: true,
  maintainerUserId: true, maintainerName: true, publishedAt: true, deletedAt: true,
} as const
export const hubSummarySelect = {
  ...skillBase, currentVersion: { select: versionBase },
} satisfies Prisma.SkillHubSkillSelect
export const hubDetailSelect = {
  ...skillBase,
  currentVersion: { select: { ...versionBase, packageDescription: true, manifest: true, mainObject: objectMeta } },
  iconObject: objectMeta,
} satisfies Prisma.SkillHubSkillSelect
export const hubAdminSelect = {
  id: true, teamId: true, team: skillBase.team, displayName: true,
  revision: true, createdById: true, createdByName: true, maintainerUserId: true, maintainerName: true,
  deletedAt: true, currentVersion: { select: { number: true, packageName: true } },
} satisfies Prisma.SkillHubSkillSelect

export type HubDetailRow = Prisma.SkillHubSkillGetPayload<{ select: typeof hubDetailSelect }>
type SummaryRow = Prisma.SkillHubSkillGetPayload<{ select: typeof hubSummarySelect }>
type AdminRow = Prisma.SkillHubSkillGetPayload<{ select: typeof hubAdminSelect }>
type Maintained = Pick<SummaryRow, "teamId" | "maintainerUserId">

export const hubUnavailable = () => hubError(404, "HUB_NOT_AVAILABLE", "该 Skill 不存在或当前账号无权访问。")

export function readableHubSkills(userId: string): Prisma.SkillHubSkillWhereInput {
  return { deletedAt: null, currentVersionId: { not: null }, team: { members: { some: { userId, user: { status: "active" } } } } }
}

const memberKey = (teamId: string, userId: string) => `${teamId}:${userId}`

export async function hubMaintainers(db: Prisma.TransactionClient, rows: Maintained[]): Promise<(row: Maintained) => boolean> {
  const OR = rows.flatMap(({ teamId, maintainerUserId }) => maintainerUserId ? [{ teamId, userId: maintainerUserId }] : [])
  const members = OR.length ? await db.teamMembership.findMany({
    where: { OR, user: { status: "active" } }, select: { teamId: true, userId: true }, take: OR.length,
  }) : []
  const active = new Set(members.map(({ teamId, userId }) => memberKey(teamId, userId)))
  return ({ teamId, maintainerUserId }) => maintainerUserId !== null && active.has(memberKey(teamId, maintainerUserId))
}

function people(row: Pick<SummaryRow, "createdById" | "createdByName" | "maintainerUserId" | "maintainerName">, active: boolean) {
  return {
    createdBy: { id: row.createdById, displayName: row.createdByName },
    maintainer: { id: row.maintainerUserId, displayName: row.maintainerName, isActiveMember: active },
  }
}

export function hubSummary(row: SummaryRow, userId: string, activeMaintainer: boolean): SkillHubSummary {
  const version = row.currentVersion
  if (!version) throw hubUnavailable()
  const canMaintain = activeMaintainer && row.maintainerUserId === userId
  return {
    id: row.id,
    team: row.team,
    displayName: row.displayName,
    displayDescription: row.displayDescription,
    iconUrl: row.iconObjectId ? `/api/skill-hub/skills/${row.id}/icon` : null,
    package: { name: version.packageName },
    currentVersion: {
      id: version.id, number: version.number, contentFingerprint: version.contentFingerprint,
      archiveSha256: version.archiveObject.sha256,
    },
    revision: row.revision,
    ...people(row, activeMaintainer),
    permissions: { canEditMetadata: canMaintain, canPublishVersion: canMaintain, canDelete: canMaintain },
    publishedAt: row.publishedAt.toISOString(),
  }
}

export function hubDetail(row: HubDetailRow, userId: string, activeMaintainer: boolean): SkillHubDetail {
  const summary = hubSummary(row, userId, activeMaintainer)
  return {
    ...summary,
    package: { name: summary.package.name, description: row.currentVersion!.packageDescription },
    files: skillHubManifestSchema.parse(row.currentVersion!.manifest),
  }
}

export function hubAdminRow(row: AdminRow, activeMaintainer: boolean): SkillHubAdminRow {
  if (!row.currentVersion) throw hubUnavailable()
  return {
    id: row.id, team: row.team, displayName: row.displayName, packageName: row.currentVersion.packageName,
    ...people(row, activeMaintainer),
    currentVersionNumber: row.currentVersion.number, revision: row.revision, deletedAt: row.deletedAt?.toISOString() ?? null,
  }
}
