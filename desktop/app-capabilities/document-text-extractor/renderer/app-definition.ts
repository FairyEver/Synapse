import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { DOCUMENT_TEXT_EXTRACTOR_APP_ID } from "../shared/capability"

export const documentTextExtractorAppDefinition = {
  id: DOCUMENT_TEXT_EXTRACTOR_APP_ID,
  namespace: "document_text_extractor",
  type: "system",
  name: "文档文本提取",
  windowTitle: "文档文本提取",
  dock: { pinnedByDefault: false, order: 245 },
  window: { openable: true },
  capabilities: {
    primaryMcpPrefix: "app_document_text_extractor",
  },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
