import type { SynapseSystemAppDefinition } from "../apps/types"

export const gitAppDefinition = {
  id: "git",
  namespace: "git",
  type: "system",
  name: "Git",
  windowTitle: "Git",
  dock: { pinnedByDefault: false, order: 220 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
