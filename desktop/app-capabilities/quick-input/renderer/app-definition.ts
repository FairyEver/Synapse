import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { QUICK_INPUT_APP_ID } from "../shared/capability"

export const quickInputAppDefinition = {
  id: QUICK_INPUT_APP_ID,
  namespace: "quick_input",
  type: "system",
  name: "快捷输入",
  windowTitle: "快捷输入",
  dock: { pinnedByDefault: false, order: 250 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
