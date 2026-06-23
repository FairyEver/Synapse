import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { DOCUMENT_TEMPLATE_APP_ID } from "../shared/capability"

export const documentTemplateAppDefinition = {
  id: DOCUMENT_TEMPLATE_APP_ID,
  type: "system",
  name: "从模板生成 Word 文档",
  windowTitle: "从模板生成 Word 文档",
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
