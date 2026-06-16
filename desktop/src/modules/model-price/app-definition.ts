import type { SynapseSystemAppDefinition } from "../apps/types"

export const modelPriceAppDefinition = {
  id: "model-price",
  type: "system",
  name: "价格管理",
  windowTitle: "价格管理",
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
