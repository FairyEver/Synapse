import type { SynapseSystemAppDefinition } from "../apps/types"

export const usageMonitorAppDefinition = {
  id: "usage-monitor",
  namespace: "usage_monitor",
  type: "system",
  name: "用量监控",
  windowTitle: "用量监控",
  defaultView: "cc",
  dock: { pinnedByDefault: false, order: 280 },
  window: { openable: true },
  capabilities: {
    primaryMcpPrefix: "app_usage_monitor",
  },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
