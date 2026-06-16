import type { SynapseSystemAppDefinition } from "@/modules/apps/types"

export const resourceRepositoryAppDefinition = {
  id: "resource-repository",
  type: "system",
  name: "资源仓库",
  windowTitle: "资源仓库",
  defaultView: "skill",
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
