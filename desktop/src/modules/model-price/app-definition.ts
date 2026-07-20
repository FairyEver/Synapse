import type { SynapseSystemAppDefinition } from "../apps/types"

export const modelPriceAppDefinition = {
  id: "model-price",
  namespace: "model_price",
  type: "system",
  name: "价格管理",
  windowTitle: "价格管理",
  dock: { pinnedByDefault: false, order: 290 },
  window: { openable: true },
  capabilities: {
    primaryMcpPrefix: "app_model_price",
  },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
