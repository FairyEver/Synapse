import type { SynapseSystemAppDefinition } from "../apps/types"

export const workflowAppDefinition = {
  id: "workflow",
  namespace: "workflow",
  type: "system",
  name: "工作流",
  windowTitle: "工作流",
  visibility: "workflow-entry-enabled",
  dock: { pinnedByDefault: true, order: 40 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
