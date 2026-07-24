import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { SKILL_INSTALLER_APP_ID } from "../shared/capability"

export const skillInstallerAppDefinition = {
  id: SKILL_INSTALLER_APP_ID,
  namespace: "skill_installer",
  type: "system",
  name: "Skill 安装器",
  windowTitle: "Skill 安装器",
  dock: { pinnedByDefault: false, order: 280 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
