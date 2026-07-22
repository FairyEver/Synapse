import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { FILE_OPENER_APP_ID } from "../shared/capability"

export const fileOpenerAppDefinition = {
  id: FILE_OPENER_APP_ID,
  namespace: "file_opener",
  type: "system",
  name: "默认应用打开",
  windowTitle: "默认应用打开",
  dock: { pinnedByDefault: false, order: 242 },
  window: { openable: true },
  capabilities: { primaryMcpPrefix: "app_file_opener" },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition

