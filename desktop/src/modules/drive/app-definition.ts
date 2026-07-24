import type { SynapseSystemAppDefinition } from "../apps/types"

export const driveAppDefinition = {
  id: "drive",
  namespace: "drive",
  type: "system",
  name: "云盘",
  windowTitle: "云盘",
  dock: { pinnedByDefault: true, order: 20 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
