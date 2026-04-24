import type { SynapseContentType } from "../types/content"
import type { DataStoreMcpTarget } from "../types/data-store"

export type SynapseIdeDefinition = {
  id: string
  label: string
  order: number
  icon: string
  supportsGlobal: boolean
  supportsProject: boolean
  supportedContentTypes: SynapseContentType[]
}

export type SynapseCliDefinition = {
  id: string
  label: string
  order: number
  binaries: string[]
}

export type SynapseMcpDefinition = {
  target: DataStoreMcpTarget
  label: string
  order: number
  icon: string
}

export type SynapseInstallRuleProjectForm = "cursor-frontmatter" | "claude-code-frontmatter"

export type SynapseInstallFormDefinition = {
  ruleProjectForm: SynapseInstallRuleProjectForm
}
