import type { ComponentType } from "react"
import type { SynapseContentMeta } from "../types/content"
import type { SynapseContentType } from "../types/content"
import type { McpTarget } from "../types/mcp"
import type { SynapseAgentDisplayProfile } from "../types/agent"
import type {
  SynapseEditorInstallFormValues,
  SynapseEditorResolvedTarget,
} from "../types/editor"

export type SynapseEditorDefinition = {
  id: string
  label: string
  order: number
  icon: string
  supportsGlobal: boolean
  supportsProject: boolean
  supportedContentTypes: SynapseContentType[]
}

export type SynapseMcpDefinition = {
  target: McpTarget
  label: string
  order: number
  settingsPathSegments: readonly string[]
  settingsFormat: "json-mcp-servers" | "codex-toml" | "hermes-yaml"
}

export type SynapseRendererMcpDefinition = SynapseMcpDefinition & {
  icon: string
}

export type SynapseRuleProjectInstallFormProps = {
  editorId: string
  item: Pick<SynapseContentMeta<"rule">, "description">
  isSubmitting: boolean
  onConfirm: (values: SynapseEditorInstallFormValues) => void
  onError: (message: string) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  target: Extract<SynapseEditorResolvedTarget, { status: "ready" }> | null
}

export type SynapseInstallFormDefinition = {
  RuleProjectInstallForm: ComponentType<SynapseRuleProjectInstallFormProps>
  RuleGlobalInstallForm?: ComponentType<SynapseRuleProjectInstallFormProps>
}

export type SynapseAgentCommandOption = {
  name: string
  description: string
}

export type SynapseAgentModeOption = {
  key: string
  label: string
  unattended?: boolean
}

export type SynapseAgentRuntimeRequirement = {
  kind: "local-cli"
  binaries: readonly string[]
}

export type SynapseAgentCapabilities = {
  chat: boolean
  projectContext: boolean
  permissions: boolean
  mcp: boolean
}

export type SynapseAgentBaseDefinition = {
  id: string
  label: string
  order: number
  relatedEditorId?: string
  runtime: SynapseAgentRuntimeRequirement
  modes: readonly SynapseAgentModeOption[]
  commands: readonly SynapseAgentCommandOption[]
  capabilities: SynapseAgentCapabilities
  displayProfile: SynapseAgentDisplayProfile
}

export type SynapseAgentDefinition = SynapseAgentBaseDefinition & {
  icon: string
}
