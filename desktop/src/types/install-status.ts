import type { SynapseEditorId } from "./editor"

export type InstallStatusEntry = {
  editorId: SynapseEditorId
  scope: "global" | "project"
  projectName?: string
  projectPath?: string
}

export type InstallStatusMap = Record<string, InstallStatusEntry[]>

export type InstallStatusChangedEvent = {
  contentId: string
  entries: InstallStatusEntry[]
}
