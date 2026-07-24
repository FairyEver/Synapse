import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { SKILL_UNINSTALLER_APP_ID } from "../shared/capability"

export const skillUninstallerAppDefinition = {
  id: SKILL_UNINSTALLER_APP_ID,
  namespace: "skill_uninstaller",
  type: "system",
  name: "Skill 卸载器",
  windowTitle: "Skill 卸载器",
  dock: { pinnedByDefault: false, order: 285 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
