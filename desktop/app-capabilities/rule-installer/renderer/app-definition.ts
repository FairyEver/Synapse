import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { RULE_INSTALLER_APP_ID } from "../shared/capability"

export const ruleInstallerAppDefinition = {
  id: RULE_INSTALLER_APP_ID,
  namespace: "rule_installer",
  type: "system",
  name: "Rule 安装器",
  windowTitle: "Rule 安装器",
  dock: { pinnedByDefault: false, order: 281 },
  window: { openable: true },
  capabilities: {
    primaryMcpPrefix: "app_rule_installer",
  },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
