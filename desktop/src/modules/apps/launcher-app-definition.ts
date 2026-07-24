import type { SynapseSystemAppDefinition } from "./types"

export const launcherAppDefinition = {
  id: "launcher",
  namespace: "launcher",
  type: "system",
  name: "应用",
  windowTitle: "应用",
  dock: { pinnedByDefault: true, order: 60 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
