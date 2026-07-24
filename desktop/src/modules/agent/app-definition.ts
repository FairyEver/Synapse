import type { SynapseSystemAppDefinition } from "../apps/types"

export const agentAppDefinition = {
  id: "agent",
  namespace: "agent",
  type: "system",
  name: "对话",
  windowTitle: "对话",
  dock: { pinnedByDefault: true, order: 10 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
