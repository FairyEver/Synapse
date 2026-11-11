import {
  SYSTEM_APP_IDS,
  type SynapseAppId,
  type SynapseSystemAppId,
} from "@synapse/shared/custom-apps-contracts"

export { SYSTEM_APP_IDS, type SynapseAppId, type SynapseSystemAppId }
export type SynapseAppType = "system"
export type SynapseSystemAppNamespace =
  | "agent"
  | "agent_personas"
  | "workflow"
  | "drive"
  | "mail_internal"
  | "mail"
  | "todos"
  | "tunnel"
  | "automation"
  | "launcher"
  | "settings"
  | "resource_repository"
  | "skill_hub"
  | "git"
  | "database"
  | "synapse_skill"
  | "secrets"
  | "quick_input"
  | "terminal"
  | "editor_scan"
  | "model_price"
  | "connectors"
  | "meeting"
export type ResourceRepositoryViewId = "skill" | "rule" | "prompt"
export type DatabaseAppViewId = "tables" | "status" | "management"
export type SynapseSystemAppDefaultView = ResourceRepositoryViewId
export type SynapseSystemAppDockVisibility = "always" | "workflow-entry-enabled"

export type SynapseSystemAppDockMetadata = {
  readonly pinnedByDefault: boolean
  readonly order: number
  readonly pinnable?: boolean
}

export type SynapseSystemAppWindowMetadata = {
  readonly openable: boolean
}

export type SynapseSystemAppDefinition = {
  readonly id: SynapseSystemAppId
  readonly namespace: SynapseSystemAppNamespace
  readonly type: "system"
  readonly name: string
  readonly windowTitle: string
  readonly defaultView?: SynapseSystemAppDefaultView
  readonly visibility?: SynapseSystemAppDockVisibility
  readonly dock: SynapseSystemAppDockMetadata
  readonly window: SynapseSystemAppWindowMetadata
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

export type SynapseSystemAppGitOpenRequest = {
  readonly requestId: string
  readonly repositoryId: string
}

export type SynapseSystemAppTerminalOpenRequest = {
  readonly requestId: string
  readonly sessionId: string
}

export type SynapseSystemAppMailInternalOpenRequest = {
  readonly requestId: string
  readonly messageId: string
}

export type TodoOpenRequest = { readonly requestId: string; readonly id: string }

export type AppViewOpenRequest={readonly requestId:string;readonly path:string}
export type SynapseSystemAppOpenOptions = {
  readonly viewOpenRequest?:AppViewOpenRequest|null
  readonly todoOpenRequest?: TodoOpenRequest | null
  readonly contentOpenRequest?: SynapseSystemAppContentOpenRequest | null
  readonly gitOpenRequest?: SynapseSystemAppGitOpenRequest | null
  readonly terminalOpenRequest?: SynapseSystemAppTerminalOpenRequest | null
  readonly mailOpenRequest?: import("../../../app-capabilities/mail/shared/private-schema").MailOpenRequest | null
  readonly mailInternalOpenRequest?: SynapseSystemAppMailInternalOpenRequest | null
}

export function isSystemAppId(value: string): value is SynapseSystemAppId {
  return (SYSTEM_APP_IDS as readonly string[]).includes(value)
}
