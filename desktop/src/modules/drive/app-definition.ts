import type { SynapseSystemAppDefinition } from "../apps/types"

export const driveAppDefinition = {
  id: "drive",
  namespace: "drive",
  type: "system",
  name: "云盘",
  windowTitle: "云盘",
  dock: { pinnedByDefault: true, order: 30 },
  window: { openable: true },
  capabilities: {
    primaryMcpPrefix: "app_drive",
  },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
