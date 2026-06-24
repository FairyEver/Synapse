import type { SynapseSystemAppDefinition } from "../apps/types"

export const editorScanAppDefinition = {
  id: "editor-scan",
  namespace: "editor_scan",
  type: "system",
  name: "IDE 管理",
  windowTitle: "IDE 管理",
  dock: { pinnedByDefault: false, order: 270 },
  window: { openable: true },
  capabilities: {
    primaryMcpPrefix: "app_editor_scan",
  },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
