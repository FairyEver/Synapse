export type SynapseContentType = "rule" | "skill"

export type SynapseContentSchemaVersion = 1

export type SynapseContentMetaRecord = {
  schemaVersion: SynapseContentSchemaVersion
  id: string
  type: SynapseContentType
  createdBy: string
  createdByDisplayName: string
  createdAt: string
}

export type SynapseContentSnapshotRecord = {
  schemaVersion: SynapseContentSchemaVersion
  title: string
  description: string
  category: string
  icon: string
  iconBg: string
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
  description: string
  category: string
  icon: string
  iconBg: string
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

export type SynapseRuleMeta = SynapseContentSummaryBase & {
  type: "rule"
}

export type SynapseSkillMeta = SynapseContentSummaryBase & {
  type: "skill"
}

export type SynapseContentMeta = SynapseRuleMeta | SynapseSkillMeta

type SynapseContentDetailBase = SynapseContentSummaryBase & {
  content: string
  attachments: SynapseContentAttachmentRecord[]
}

export type SynapseRuleDetail = SynapseContentDetailBase & {
  type: "rule"
}

export type SynapseSkillDetail = SynapseContentDetailBase & {
  type: "skill"
}

export type SynapseContentDetail = SynapseRuleDetail | SynapseSkillDetail

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
  content: string
}

export type SynapseCreateRulePayload = SynapseCreateContentPayloadBase

export type SynapseCreateSkillFilePayload = {
  originalName: string
  size: number
  bytes: Uint8Array
}

export type SynapseCreateSkillPayload = SynapseCreateContentPayloadBase & {
  files: SynapseCreateSkillFilePayload[]
}

type SynapseUpdateContentPayloadBase = SynapseCreateContentPayloadBase & {
  id: string
  baseHistoryDirname: string
  force?: boolean
}

export type SynapseUpdateRulePayload = SynapseUpdateContentPayloadBase

export type SynapseUpdateSkillPayload = SynapseUpdateContentPayloadBase & {
  files: SynapseCreateSkillFilePayload[]
}

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
