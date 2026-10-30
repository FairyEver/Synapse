import type { SynapseSystemAppDefinition } from "../apps/types"
export const gameHallAppDefinition = {
  id: "game-hall",
  namespace: "game",
  type: "system",
  name: "游戏大厅",
  windowTitle: "游戏大厅",
  dock: { pinnedByDefault: false, order: 27, pinnable: true },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
