import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { TEXT_EXTRACTOR_APP_ID } from "../shared/capability"

export const textExtractorAppDefinition = {
  id: TEXT_EXTRACTOR_APP_ID,
  namespace: "text_extractor",
  type: "system",
  name: "文本提取",
  windowTitle: "文本提取",
  dock: { pinnedByDefault: false, order: 245 },
  window: { openable: true },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
