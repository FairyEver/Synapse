export const SYSTEM_APP_IDS = [
  "resource-repository",
  "git",
  "database",
  "document-template",
  "terminal",
  "screenshot",
  "editor-scan",
  "usage-monitor",
  "model-price",
] as const

export type SynapseSystemAppId = (typeof SYSTEM_APP_IDS)[number]
export type SynapseAppType = "system"
export type ResourceRepositoryViewId = "skill" | "rule" | "prompt"
export type UsageMonitorViewId = "cc" | "codex"
export type DatabaseAppViewId = "tables" | "status" | "management" | "mcp"
export type SynapseSystemAppDefaultView = ResourceRepositoryViewId | UsageMonitorViewId

export type SynapseSystemAppDefinition = {
  readonly id: SynapseSystemAppId
  readonly type: "system"
  readonly name: string
  readonly windowTitle: string
  readonly defaultView?: SynapseSystemAppDefaultView
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
