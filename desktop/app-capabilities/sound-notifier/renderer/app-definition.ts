import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { SOUND_NOTIFIER_APP_ID } from "../shared/capability"

export const soundNotifierAppDefinition = {
  id: SOUND_NOTIFIER_APP_ID,
  namespace: "sound_notifier",
  type: "system",
  name: "Sound Notifier",
  windowTitle: "Sound Notifier",
  dock: { pinnedByDefault: false, order: 290 },
  window: { openable: true },
  capabilities: {
    primaryMcpPrefix: "app_sound_notifier",
  },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
