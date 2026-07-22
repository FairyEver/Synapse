export const SYSTEM_APP_IDS = [
  "agent",
  "agent-personas",
  "workflow",
  "drive",
  "automation",
  "launcher",
  "settings",
  "resource-repository",
  "git",
  "database",
  "document-template",
  "text-extractor",
  "file-opener",
  "text-file-writer",
  "skill-installer",
  "skill-uninstaller",
  "synapse-skill",
  "secrets",
  "rule-installer",
  "quick-input",
  "sound-notifier",
  "terminal",
  "editor-scan",
  "usage-monitor",
  "model-price",
] as const

export type SynapseSystemAppId = (typeof SYSTEM_APP_IDS)[number]
export type SynapseAppType = "system"
export type SynapseSystemAppNamespace =
  | "agent"
  | "agent_personas"
  | "workflow"
  | "drive"
  | "automation"
  | "launcher"
  | "settings"
  | "resource_repository"
  | "git"
  | "database"
  | "document_template"
  | "text_extractor"
  | "file_opener"
  | "text_file_writer"
  | "skill_installer"
  | "skill_uninstaller"
  | "synapse_skill"
  | "secrets"
  | "rule_installer"
  | "quick_input"
  | "sound_notifier"
  | "terminal"
  | "editor_scan"
  | "usage_monitor"
  | "model_price"
export type ResourceRepositoryViewId = "skill" | "rule" | "prompt"
export type UsageMonitorViewId = "cc" | "codex"
export type DatabaseAppViewId = "tables" | "status" | "management" | "mcp"
export type SynapseSystemAppDefaultView = ResourceRepositoryViewId | UsageMonitorViewId
export type SynapseSystemAppDockVisibility = "always" | "workflow-entry-enabled"

export type SynapseSystemAppDockMetadata = {
  readonly pinnedByDefault: boolean
  readonly order: number
  readonly visibility?: SynapseSystemAppDockVisibility
}

export type SynapseSystemAppWindowMetadata = {
  readonly openable: boolean
}

export type SynapseSystemAppCapabilityMetadata = {
  readonly primaryMcpPrefix: `app_${string}`
}

export type SynapseSystemAppDefinition = {
  readonly id: SynapseSystemAppId
  readonly namespace: SynapseSystemAppNamespace
  readonly type: "system"
  readonly name: string
  readonly windowTitle: string
  readonly defaultView?: SynapseSystemAppDefaultView
  readonly dock: SynapseSystemAppDockMetadata
  readonly window: SynapseSystemAppWindowMetadata
  readonly capabilities: SynapseSystemAppCapabilityMetadata
  readonly removable: false
  readonly renameable: false
  readonly iconEditable: false
}

export type SynapseSystemAppManifest = SynapseSystemAppDefinition & {
  readonly icon: string
}

export type SynapseSystemAppContentOpenRequest = {
  readonly kind: "create" | "detail" | "edit-overwrite"
  readonly requestId: string
  readonly contentType: "rule" | "skill"
  readonly contentId?: string
  readonly [key: string]: unknown
}

export type SynapseSystemAppOpenOptions = {
  readonly contentOpenRequest?: SynapseSystemAppContentOpenRequest | null
}

export function isSystemAppId(value: string): value is SynapseSystemAppId {
  return (SYSTEM_APP_IDS as readonly string[]).includes(value)
}
