import type { SynapseSystemAppDefinition } from "../apps/types"

export const workflowAppDefinition = {
  id: "workflow",
  namespace: "workflow",
  type: "system",
  name: "工作流",
  windowTitle: "工作流",
  dock: { pinnedByDefault: true, order: 20, visibility: "workflow-entry-enabled" },
  window: { openable: true },
  capabilities: {
    primaryMcpPrefix: "app_workflow",
  },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
