import type { SynapseEditorId } from "./editor"

export type InstallStatusValue = "installed" | "needs_update"

export type InstallStatusEntry = {
  editorId: SynapseEditorId
  scope: "global" | "project"
  projectName?: string
  projectPath?: string
  status: InstallStatusValue
}

export type InstallStatusMap = Record<string, InstallStatusEntry[]>

export type InstallStatusChangedEvent = {
  contentId: string
  entries: InstallStatusEntry[]
}

export type InstallStatusUninstallResult = {
  warning?: string
}
