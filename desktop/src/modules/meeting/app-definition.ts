import type { SynapseSystemAppDefinition } from "../apps/types"

export const meetingAppDefinition = {
  id: "meeting",
  namespace: "meeting",
  type: "system",
  name: "会议记录",
  windowTitle: "会议记录",
  dock: { pinnedByDefault: false, order: 240 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
