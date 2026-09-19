import type { SynapseSystemAppDefinition } from "../apps/types"

export const meetingAppDefinition = {
  id: "meeting",
  namespace: "meeting",
  type: "system",
  name: "录音",
  windowTitle: "录音",
  dock: { pinnedByDefault: false, order: 240 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
