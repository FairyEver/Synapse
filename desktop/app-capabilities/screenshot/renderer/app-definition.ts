import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { SCREENSHOT_APP_ID } from "../shared/capability"

export const screenshotAppDefinition = {
  id: SCREENSHOT_APP_ID,
  namespace: "screenshot",
  type: "system",
  name: "截图",
  windowTitle: "截图",
  dock: { pinnedByDefault: false, order: 260 },
  window: { openable: true },
  capabilities: {
    primaryMcpPrefix: "app_screenshot",
  },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
