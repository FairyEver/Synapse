import type { SynapseSystemAppDefinition } from "../apps/types"

export const automationAppDefinition = {
  id: "automation",
  namespace: "automation",
  type: "system",
  name: "自动化",
  windowTitle: "自动化",
  dock: { pinnedByDefault: true, order: 40 },
  window: { openable: true },
  capabilities: {
    primaryMcpPrefix: "app_automation",
  },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
