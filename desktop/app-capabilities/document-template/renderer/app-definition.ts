import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { DOCUMENT_TEMPLATE_APP_ID } from "../shared/capability"

export const documentTemplateAppDefinition = {
  id: DOCUMENT_TEMPLATE_APP_ID,
  namespace: "document_template",
  type: "system",
  name: "模板生成文档",
  windowTitle: "模板生成文档",
  dock: { pinnedByDefault: false, order: 240 },
  window: { openable: true },
  capabilities: {
    primaryMcpPrefix: "app_document_template",
  },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
