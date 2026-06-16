import type { SynapseSystemAppDefinition } from "../apps/types"

export const databaseAppDefinition = {
  id: "database",
  type: "system",
  name: "本地数据库",
  windowTitle: "本地数据库",
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
