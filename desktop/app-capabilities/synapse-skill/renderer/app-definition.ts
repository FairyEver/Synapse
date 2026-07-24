import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { SYNAPSE_SKILL_APP_ID } from "../shared/capability"

const synapseSkillAppDefinition = {
  id: SYNAPSE_SKILL_APP_ID,
  namespace: "synapse_skill",
  type: "system",
  name: "Synapse Skill",
  windowTitle: "Synapse Skill",
  dock: { pinnedByDefault: false, order: 290 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition

export { synapseSkillAppDefinition }
