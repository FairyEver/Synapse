import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
export const tunnelAppDefinition = {
  id: "tunnel", namespace: "tunnel", type: "system", name: "内网穿透", windowTitle: "内网穿透",
  dock: { pinnedByDefault: false, pinnable: true, order: 212 }, window: { openable: true }, removable: false, renameable: false, iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
