import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { HTML_GENERATOR_APP_ID } from "../shared/capability"

export const htmlGeneratorAppDefinition = {
  id: HTML_GENERATOR_APP_ID,
  namespace: "html_generator",
  type: "system",
  name: "HTML 生成器",
  windowTitle: "HTML 生成器",
  dock: { pinnedByDefault: false, order: 243 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
