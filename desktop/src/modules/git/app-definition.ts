import type { SynapseSystemAppDefinition } from "../apps/types"

export const gitAppDefinition = {
  id: "git",
  type: "system",
  name: "Git",
  windowTitle: "Git",
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
