import type { SynapseSystemAppDefinition } from "../apps/types"

export const resourceRepositoryAppDefinition = {
  id: "resource-repository",
  namespace: "resource_repository",
  type: "system",
  name: "资源仓库",
  windowTitle: "资源仓库",
  defaultView: "skill",
  dock: { pinnedByDefault: false, order: 210 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
