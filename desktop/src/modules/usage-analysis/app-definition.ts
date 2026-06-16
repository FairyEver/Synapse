import type { SynapseSystemAppDefinition } from "@/modules/apps/types"

export const usageMonitorAppDefinition = {
  id: "usage-monitor",
  type: "system",
  name: "用量监控",
  windowTitle: "用量监控",
  defaultView: "cc",
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
