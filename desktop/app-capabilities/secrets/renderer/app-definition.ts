import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { SECRETS_APP_ID } from "../shared/capability"

export const secretsAppDefinition = {
  id: SECRETS_APP_ID,
  namespace: "secrets",
  type: "system",
  name: "密钥库",
  windowTitle: "密钥库",
  dock: { pinnedByDefault: false, order: 260 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
