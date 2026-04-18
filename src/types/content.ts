export type SynapseContentType = "rule" | "skill"

type SynapseContentMetaBase = {
  id: string
  title: string
  description: string
  category: string
  icon: string
  iconBg: string
  author: string
  gitUser: string
  createdAt: string
}

export type SynapseRuleMeta = SynapseContentMetaBase & {
  type: "rule"
}

export type SynapseSkillMeta = SynapseContentMetaBase & {
  type: "skill"
  files: string[]
}

export type SynapseContentMeta = SynapseRuleMeta | SynapseSkillMeta

type SynapseContentFileBase = {
  relativePath: string
  name: string
  size: number
}

export type SynapseTextContentFile = SynapseContentFileBase & {
  kind: "text"
  content: string
}

export type SynapseBinaryContentFile = SynapseContentFileBase & {
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
  relativePath: string
  size: number
  bytes: Uint8Array
}

export type SynapseCreateSkillPayload = SynapseCreateContentPayloadBase & {
  files: SynapseCreateSkillFilePayload[]
}

export type SynapseContentWriteResult = {
  id: string
  type: SynapseContentType
  title: string
  createdAt: string
  branchName?: string
  targetBranch?: string
  message?: string
}
