import type { SynapseSystemAppDefinition } from "../apps/types"

export const editorScanAppDefinition = {
  id: "editor-scan",
  type: "system",
  name: "IDE 管理",
  windowTitle: "IDE 管理",
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
