import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import {
  SYSTEM_NOTIFIER_APP_ID,
  SYSTEM_NOTIFIER_NAMESPACE,
} from "../shared/capability"

export const systemNotifierAppDefinition = {
  id: SYSTEM_NOTIFIER_APP_ID,
  namespace: SYSTEM_NOTIFIER_NAMESPACE,
  type: "system",
  name: "System Notifier",
  windowTitle: "System Notifier",
  dock: { pinnedByDefault: false, order: 300 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
