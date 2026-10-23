import type { SynapseSystemAppDefinition } from "../apps/types"

export const mailInternalAppDefinition = {
  id: "mail-internal",
  namespace: "mail_internal",
  type: "system",
  name: "站内信",
  windowTitle: "站内信",
  dock: { pinnedByDefault: true, order: 55 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
