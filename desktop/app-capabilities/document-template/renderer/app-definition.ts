import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { DOCUMENT_TEMPLATE_APP_ID } from "../shared/capability"

export const documentTemplateAppDefinition = {
  id: DOCUMENT_TEMPLATE_APP_ID,
  type: "system",
  name: "模板生成文档",
  windowTitle: "模板生成文档",
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
