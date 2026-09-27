import type { SynapseSystemAppDefinition } from "../apps/types"

export const mailAppDefinition = {
  id: "mail",
  namespace: "mail",
  type: "system",
  name: "站内信",
  windowTitle: "站内信",
  dock: { pinnedByDefault: false, order: 25 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
