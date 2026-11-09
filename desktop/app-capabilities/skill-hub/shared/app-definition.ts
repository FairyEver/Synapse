import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"

export const skillHubAppDefinition = {
  id: "skill-hub",
  namespace: "skill_hub",
  type: "system",
  name: "SkillHub",
  windowTitle: "SkillHub",
  dock: { pinnedByDefault: false, pinnable: true, order: 211 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
