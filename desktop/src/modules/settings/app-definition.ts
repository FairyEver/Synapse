import type { SynapseSystemAppDefinition } from "../apps/types"

export const settingsAppDefinition = {
  id: "settings",
  namespace: "settings",
  type: "system",
  name: "设置",
  windowTitle: "设置",
  dock: { pinnedByDefault: true, order: 50 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
