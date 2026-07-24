import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { AGENT_PERSONAS_APP_ID } from "../shared/capability"

export const agentPersonasAppDefinition = {
  id: AGENT_PERSONAS_APP_ID,
  namespace: "agent_personas",
  type: "system",
  name: "智能体",
  windowTitle: "智能体",
  dock: { pinnedByDefault: false, order: 15 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
