import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { CONNECTORS_APP_ID } from "../shared/capability"

export const connectorsAppDefinition = {
  id: CONNECTORS_APP_ID,
  namespace: "connectors",
  type: "system",
  name: "连接器",
  windowTitle: "连接器",
  dock: { pinnedByDefault: false, order: 260 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
