import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { SWARM_TASK_APP_ID } from "../shared/capability"

export const swarmTaskAppDefinition = {
  id: SWARM_TASK_APP_ID,
  namespace: "swarm_task",
  type: "system",
  name: "蜂群任务",
  windowTitle: "蜂群任务",
  dock: { pinnedByDefault: false, order: 340 },
  window: { openable: true },
  capabilities: {
    primaryMcpPrefix: "app_swarm_task",
  },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
