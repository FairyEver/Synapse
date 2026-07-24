import type { SynapseSystemAppDefinition } from "../apps/types"

export const databaseAppDefinition = {
  id: "database",
  namespace: "database",
  type: "system",
  name: "本地数据库",
  windowTitle: "本地数据库",
  dock: { pinnedByDefault: false, order: 230 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
