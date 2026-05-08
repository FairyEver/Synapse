import type { SynapseEditorId } from "./editor"

export type InstallStatusMap = Record<string, SynapseEditorId[]>

export type InstallStatusChangedEvent = {
  contentId: string
  editors: SynapseEditorId[]
}
