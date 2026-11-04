import { z } from "zod"

const MiB = 1024 * 1024
export const SKILL_HUB_LIMITS = {
  mainBytes: MiB,
  attachmentBytes: 10 * MiB,
  packageBytes: 50 * MiB,
  uploadBytes: 50 * MiB,
  attachments: 100,
  archiveEntries: 2000,
  archiveDirectories: 200,
  directoryDepth: 8,
  parseTimeMs: 10_000,
  originalIconBytes: 2 * MiB,
  iconBytes: MiB,
  iconSize: 256,
  preparedTtlMs: 30 * 60_000,
  uploadTtlMs: 24 * 60 * 60_000,
  receiptTtlMs: 24 * 60 * 60_000,
  defaultPageSize: 20,
  maxPageSize: 100,
} as const

export const skillHubIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const id = skillHubIdSchema
const requestId = id
const positive = z.int().positive()
const utc = z.iso.datetime()
const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
const fingerprint = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const nonBlank = (max: number) => z.string().max(max * 2).refine((s) => s.trim().length > 0 && [...s].length <= max && !s.includes("\0"))
const displayName = nonBlank(100)
const displayDescription = nonBlank(2000)
const localPath = nonBlank(4096)
const cursor = z.string().min(1).max(2048)
const paging = { cursor: cursor.optional(), limit: positive.max(SKILL_HUB_LIMITS.maxPageSize).optional() }

export const skillHubPackageNameSchema = z.string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/)
  .refine((value) => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(value))

export const skillHubTeamSchema = z.strictObject({ id, name: z.string() })
export const skillHubTeamQuerySchema = z.strictObject(paging)
export const skillHubTeamPageSchema = z.strictObject({
  items: z.array(skillHubTeamSchema).max(SKILL_HUB_LIMITS.maxPageSize),
  nextCursor: cursor.nullable(),
  selectionState: z.enum(["none", "single", "multiple"]),
  defaultTeamId: id.nullable(),
}).refine((page) => page.selectionState === "single"
  ? page.defaultTeamId !== null && page.items.length <= 1 && page.nextCursor === null
    && (page.items.length === 0 || page.items[0].id === page.defaultTeamId)
  : page.defaultTeamId === null && (page.selectionState !== "none" || (page.items.length === 0 && page.nextCursor === null)))

const person = z.strictObject({ id: id.nullable(), displayName: z.string() })
const maintainer = person.extend({ isActiveMember: z.boolean() })
export const skillHubPackageInfoSchema = z.strictObject({
  name: skillHubPackageNameSchema,
  description: z.string().min(1).max(SKILL_HUB_LIMITS.mainBytes),
})
export const skillHubManifestSchema = z.array(z.strictObject({
  path: z.string().min(1).max(1024),
  size: z.int().nonnegative().max(SKILL_HUB_LIMITS.attachmentBytes),
  sha256,
})).min(1).max(SKILL_HUB_LIMITS.attachments + 1)
export const skillHubVersionSchema = z.strictObject({
  id,
  number: positive,
  contentFingerprint: fingerprint,
  archiveSha256: sha256,
})
export const skillHubDetailSchema = z.strictObject({
  id,
  team: skillHubTeamSchema,
  displayName,
  displayDescription,
  iconUrl: z.string().regex(/^\/api\/skill-hub\/skills\/[A-Za-z0-9_-]{1,128}\/icon$/).nullable(),
  package: skillHubPackageInfoSchema,
  currentVersion: skillHubVersionSchema,
  revision: positive,
  createdBy: person,
  maintainer,
  permissions: z.strictObject({ canEditMetadata: z.boolean(), canPublishVersion: z.boolean(), canDelete: z.boolean() }),
  files: skillHubManifestSchema,
  publishedAt: utc,
})
export const skillHubListInputSchema = z.strictObject({
  ...paging,
  teamId: id.optional(),
  createdByMe: z.boolean().optional(),
  query: z.string().max(200).optional(),
})
export const skillHubSummarySchema = skillHubDetailSchema.omit({ files: true, package: true }).extend({
  package: skillHubPackageInfoSchema.pick({ name: true }),
})
export const skillHubPageSchema = z.strictObject({
  items: z.array(skillHubSummarySchema).max(SKILL_HUB_LIMITS.maxPageSize),
  nextCursor: cursor.nullable(),
})

export const skillHubCreateInputSchema = z.strictObject({
  teamId: id, packageUploadId: id, iconUploadId: id.optional(), displayName, displayDescription, requestId,
})
export const skillHubPublishInputSchema = z.strictObject({ packageUploadId: id, expectedVersionId: id, requestId })
export const skillHubRevisionInputSchema = z.strictObject({ expectedRevision: positive, requestId })
export const skillHubUpdateInputSchema = skillHubRevisionInputSchema.extend({
  displayName: displayName.optional(),
  displayDescription: displayDescription.optional(),
  iconUploadId: id.nullish(),
})
export const skillHubAssignMaintainerInputSchema = skillHubRevisionInputSchema.extend({ maintainerUserId: id })

export const skillHubWriteActionSchema = z.enum([
  "app.skill_hub.skill.create", "app.skill_hub.version.create", "app.skill_hub.skill.update", "app.skill_hub.skill.delete",
])
export const skillHubReceiptInputSchema = z.strictObject({ action: skillHubWriteActionSchema, requestId })
const writeOutcome = z.enum(["created", "published", "unchanged", "updated"])
export const skillHubReceiptResultSchema = z.strictObject({
  skillId: id, teamId: id, versionId: id, versionNumber: positive, revision: positive, outcome: z.enum([...writeOutcome.options, "deleted"]),
})
export const skillHubReceiptSchema = skillHubReceiptInputSchema.extend({
  status: z.enum(["committed", "not_found"]),
  resultAccessible: z.boolean(),
  result: skillHubReceiptResultSchema.optional(),
}).refine((receipt) => receipt.resultAccessible
  ? receipt.status === "committed" && receipt.result !== undefined
  : receipt.result === undefined)
export const skillHubWriteReplaySchema = z.strictObject({ replayed: z.literal(true), receipt: skillHubReceiptSchema })
export const skillHubWriteResultSchema = z.strictObject({ skill: skillHubDetailSchema, outcome: writeOutcome })
export const skillHubDeleteResultSchema = z.strictObject({ id, revision: positive, deletedAt: utc, outcome: z.literal("deleted") })
export const skillHubAdminListInputSchema = z.strictObject({ ...paging, teamId: id, deleted: z.boolean().optional() })
export const skillHubAdminRowSchema = z.strictObject({
  id, team: skillHubTeamSchema, displayName, packageName: skillHubPackageNameSchema, createdBy: person, maintainer,
  currentVersionNumber: positive, revision: positive, deletedAt: utc.nullable(),
})
export const skillHubAdminPageSchema = z.strictObject({
  items: z.array(skillHubAdminRowSchema).max(SKILL_HUB_LIMITS.maxPageSize), nextCursor: cursor.nullable(),
})
export const skillHubUploadInputSchema = z.discriminatedUnion("purpose", [
  z.strictObject({ teamId: id, requestId, purpose: z.literal("package"), format: z.enum(["markdown", "zip"]), fileName: nonBlank(255).optional() }),
  z.strictObject({ teamId: id, requestId, purpose: z.literal("icon"), fileName: nonBlank(255).optional() }),
])
export const skillHubUploadResultSchema = z.strictObject({
  uploadId: id, expiresAt: utc, packageInfo: skillHubPackageInfoSchema.optional(),
})
export const skillHubMainResultSchema = z.strictObject({ content: z.string().max(SKILL_HUB_LIMITS.mainBytes), versionId: id })
export const skillHubPreparedSourceSchema = z.strictObject({
  preparedSourceId: id,
  team: skillHubTeamSchema,
  expiresAt: utc,
  package: skillHubPackageInfoSchema,
  manifest: skillHubManifestSchema,
  contentFingerprint: fingerprint,
  summary: z.strictObject({
    totalBytes: z.int().nonnegative().max(SKILL_HUB_LIMITS.packageBytes),
    excludedPaths: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
})

export const skillHubMcpGetInputSchema = z.strictObject({ skillId: id })
export const skillHubMcpDownloadInputSchema = skillHubMcpGetInputSchema.extend({
  destinationDirectory: localPath, expectedVersionId: id.optional(),
})
export const skillHubMcpPrepareInputSchema = z.strictObject({ sourcePath: localPath, teamId: id.optional() })
export const skillHubMcpCreateInputSchema = z.strictObject({
  teamId: id, preparedSourceId: id, displayName: displayName.optional(),
  displayDescription: displayDescription.optional(), iconPath: localPath.optional(), requestId,
})
export const skillHubMcpPublishInputSchema = z.strictObject({ skillId: id, preparedSourceId: id, expectedVersionId: id, requestId })
export const skillHubMcpUpdateInputSchema = skillHubUpdateInputSchema.omit({ iconUploadId: true }).extend({ skillId: id, iconPath: localPath.nullish() })
export const skillHubMcpDeleteInputSchema = skillHubRevisionInputSchema.extend({ skillId: id })

export type SkillHubTeam = z.infer<typeof skillHubTeamSchema>
export type SkillHubTeamQuery = z.infer<typeof skillHubTeamQuerySchema>
export type SkillHubTeamPage = z.infer<typeof skillHubTeamPageSchema>
export type SkillHubPackageInfo = z.infer<typeof skillHubPackageInfoSchema>
export type SkillHubManifest = z.infer<typeof skillHubManifestSchema>
export type SkillHubVersion = z.infer<typeof skillHubVersionSchema>
export type SkillHubDetail = z.infer<typeof skillHubDetailSchema>
export type SkillHubListInput = z.infer<typeof skillHubListInputSchema>
export type SkillHubSummary = z.infer<typeof skillHubSummarySchema>
export type SkillHubPage = z.infer<typeof skillHubPageSchema>
export type SkillHubCreateInput = z.infer<typeof skillHubCreateInputSchema>
export type SkillHubPublishInput = z.infer<typeof skillHubPublishInputSchema>
export type SkillHubRevisionInput = z.infer<typeof skillHubRevisionInputSchema>
export type SkillHubUpdateInput = z.infer<typeof skillHubUpdateInputSchema>
export type SkillHubAssignMaintainerInput = z.infer<typeof skillHubAssignMaintainerInputSchema>
export type SkillHubWriteAction = z.infer<typeof skillHubWriteActionSchema>
export type SkillHubReceiptInput = z.infer<typeof skillHubReceiptInputSchema>
export type SkillHubReceiptResult = z.infer<typeof skillHubReceiptResultSchema>
export type SkillHubReceipt = z.infer<typeof skillHubReceiptSchema>
export type SkillHubWriteReplay = z.infer<typeof skillHubWriteReplaySchema>
export type SkillHubWriteResult = z.infer<typeof skillHubWriteResultSchema>
export type SkillHubDeleteResult = z.infer<typeof skillHubDeleteResultSchema>
export type SkillHubAdminListInput = z.infer<typeof skillHubAdminListInputSchema>
export type SkillHubAdminRow = z.infer<typeof skillHubAdminRowSchema>
export type SkillHubAdminPage = z.infer<typeof skillHubAdminPageSchema>
export type SkillHubUploadInput = z.infer<typeof skillHubUploadInputSchema>
export type SkillHubUploadResult = z.infer<typeof skillHubUploadResultSchema>
export type SkillHubMainResult = z.infer<typeof skillHubMainResultSchema>
export type SkillHubPreparedSource = z.infer<typeof skillHubPreparedSourceSchema>
export type SkillHubMcpGetInput = z.infer<typeof skillHubMcpGetInputSchema>
export type SkillHubMcpDownloadInput = z.infer<typeof skillHubMcpDownloadInputSchema>
export type SkillHubMcpPrepareInput = z.infer<typeof skillHubMcpPrepareInputSchema>
export type SkillHubMcpCreateInput = z.infer<typeof skillHubMcpCreateInputSchema>
export type SkillHubMcpPublishInput = z.infer<typeof skillHubMcpPublishInputSchema>
export type SkillHubMcpUpdateInput = z.infer<typeof skillHubMcpUpdateInputSchema>
export type SkillHubMcpDeleteInput = z.infer<typeof skillHubMcpDeleteInputSchema>
