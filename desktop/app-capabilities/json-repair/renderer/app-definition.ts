import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import {
  JSON_REPAIR_APP_ID,
  JSON_REPAIR_NAMESPACE,
} from "../shared/capability"

export const jsonRepairAppDefinition = {
  id: JSON_REPAIR_APP_ID,
  namespace: JSON_REPAIR_NAMESPACE,
  type: "system",
  name: "JSON Repair",
  windowTitle: "JSON Repair",
  dock: { pinnedByDefault: false, order: 244 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
