import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { TERMINAL_APP_ID } from "../shared/capability"

export const terminalAppDefinition = {
  id: TERMINAL_APP_ID,
  type: "system",
  name: "终端",
  windowTitle: "终端",
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
