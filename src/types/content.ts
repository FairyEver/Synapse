export type SynapseContentType = "rule" | "skill" | "prompt"
export type SynapseContentViewMode = "rendered" | "source"

export type SynapseContentSchemaVersion = 1

export type SynapseContentMetaRecord = {
  schemaVersion: SynapseContentSchemaVersion
  id: string
  type: SynapseContentType
  createdBy: string
  createdByDisplayName: string
  createdAt: string
}

export type SynapseContentIconType = "icon" | "image"

export type SynapseContentSnapshotRecord = {
  schemaVersion: SynapseContentSchemaVersion
  title: string
  /**
   * Skill-only. Required when creating/updating a Skill. Absent for Rule and for
   * legacy Skill snapshots written before this field existed; the edit dialog
   * forces migration on next save.
   */
  name?: string
  description: string
  category: string
  icon: string
  iconBg: string
  iconType?: SynapseContentIconType
  iconImage?: string
  modifiedBy: string
  modifiedByDisplayName: string
  modifiedAt: string
  deleted: boolean
}

export type SynapseContentAttachmentRecord = {
  originalName: string
  sha256: string
  size: number
}

export type SynapseContentAttachmentsRecord = {
  schemaVersion: SynapseContentSchemaVersion
  files: SynapseContentAttachmentRecord[]
}

type SynapseContentSummaryBase = {
  id: string
  title: string
  /** Skill-only identifier slug. Optional here for shared-type convenience. */
  name?: string
  description: string
  category: string
  icon: string
  iconBg: string
  iconType?: SynapseContentIconType
  iconImage?: string
  createdBy: string
  createdByDisplayName: string
  createdAt: string
  modifiedBy: string
  modifiedByDisplayName: string
  modifiedAt: string
  deleted: boolean
  latestHistoryDirname: string
  attachmentCount: number
}

export type SynapseContentMeta<T extends SynapseContentType = SynapseContentType> =
  T extends SynapseContentType ? SynapseContentSummaryBase & { type: T } : never

export type SynapseRuleMeta = SynapseContentMeta<"rule">

export type SynapseSkillMeta = SynapseContentMeta<"skill">

export type SynapsePromptMeta = SynapseContentMeta<"prompt">

type SynapseContentDetailBase = SynapseContentSummaryBase & {
  content: string
  attachments: SynapseContentAttachmentRecord[]
}

export type SynapseContentDetail<T extends SynapseContentType = SynapseContentType> =
  T extends SynapseContentType ? SynapseContentDetailBase & { type: T } : never

export type SynapseRuleDetail = SynapseContentDetail<"rule">

export type SynapseSkillDetail = SynapseContentDetail<"skill">

export type SynapsePromptDetail = SynapseContentDetail<"prompt">

export type SynapseContentHistoryEntry = {
  dirname: string
  modifiedAt: string
  modifiedBy: string
  modifiedByDisplayName: string
  deleted: boolean
  isCurrent: boolean
}

export type SynapseContentHistoryVersion = SynapseContentDetail & {
  historyDirname: string
  isCurrent: boolean
}

export type SynapseTextContentFile = {
  relativePath: string
  name: string
  size: number
  kind: "text"
  content: string
}

export type SynapseBinaryContentFile = {
  relativePath: string
  name: string
  size: number
  kind: "binary"
}

export type SynapseContentFile = SynapseTextContentFile | SynapseBinaryContentFile

type SynapseCreateContentPayloadBase = {
  title: string
  description: string
  category: string
  icon: string
  iconBg: string
  iconType: SynapseContentIconType
  iconImage: string
  iconImageBytes?: Uint8Array
  content: string
}

export type SynapseCreateSkillFilePayload = {
  originalName: string
  size: number
  sha256?: string
  bytes?: Uint8Array
}

export type SynapseCreateContentPayload<T extends SynapseContentType = SynapseContentType> =
  T extends "skill"
    ? SynapseCreateContentPayloadBase & {
        name: string
        files: SynapseCreateSkillFilePayload[]
      }
    : SynapseCreateContentPayloadBase

export type SynapseCreateRulePayload = SynapseCreateContentPayload<"rule">

export type SynapseCreateSkillPayload = SynapseCreateContentPayload<"skill">

export type SynapseCreatePromptPayload = SynapseCreateContentPayload<"prompt">

type SynapseUpdateContentPayloadBase = SynapseCreateContentPayloadBase & {
  id: string
  baseHistoryDirname: string
  force?: boolean
}

export type SynapseUpdateContentPayload<T extends SynapseContentType = SynapseContentType> =
  T extends "skill"
    ? SynapseUpdateContentPayloadBase & {
        name: string
        files: SynapseCreateSkillFilePayload[]
      }
    : SynapseUpdateContentPayloadBase

export type SynapseUpdateRulePayload = SynapseUpdateContentPayload<"rule">

export type SynapseUpdateSkillPayload = SynapseUpdateContentPayload<"skill">

export type SynapseUpdatePromptPayload = SynapseUpdateContentPayload<"prompt">

export type SynapseCreateContentRequest<T extends SynapseContentType = SynapseContentType> =
  T extends SynapseContentType ? {
    contentType: T
    payload: SynapseCreateContentPayload<T>
  } : never

export type SynapseUpdateContentRequest<T extends SynapseContentType = SynapseContentType> =
  T extends SynapseContentType ? {
    contentType: T
    payload: SynapseUpdateContentPayload<T>
  } : never

export type SynapseDeleteContentPayload = {
  id: string
  type: SynapseContentType
  baseHistoryDirname: string
  force?: boolean
}

type SynapseContentMutationResultBase = {
  id: string
  type: SynapseContentType
}

export type SynapseContentMutationSuccessResult = SynapseContentMutationResultBase & {
  status: "saved"
  title: string
  latestHistoryDirname: string
  modifiedAt: string
  pushed: boolean
  pendingPushCount: number
  message: string
}

export type SynapseContentMutationConflictResult = SynapseContentMutationResultBase & {
  status: "conflict"
  latestHistoryDirname: string
  latestModifiedAt: string
  latestModifiedByDisplayName: string
}

export type SynapseContentMutationResult =
  | SynapseContentMutationSuccessResult
  | SynapseContentMutationConflictResult

export type SynapseContentDownloadResult = {
  canceled: boolean
  filePath: string | null
}

export type SynapseContentWindowRequest = {
  contentType: SynapseContentType
  id: string
  viewMode: SynapseContentViewMode
  historyDirname?: string
}

export type SynapseOpenContentWindowPayload = SynapseContentWindowRequest & {
  title: string
}
