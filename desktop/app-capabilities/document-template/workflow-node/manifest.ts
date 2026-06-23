import { FileText } from "lucide-react"
import type { NodeManifest } from "../../../workflow-nodes/types"
import { DOCUMENT_TEMPLATE_WORKFLOW_NODE_TYPE } from "../shared/capability"
import { documentTemplateNodeCardSummary } from "./card"
import { documentTemplateNodeConfigSchema, type DocumentTemplateNodeConfig } from "./schema"

export const documentTemplateNodeManifest: NodeManifest<DocumentTemplateNodeConfig> = {
  type: DOCUMENT_TEMPLATE_WORKFLOW_NODE_TYPE,
  title: "生成 Word 文档",
  icon: FileText,
  color: "bg-primary/10",
  defaultConfig: {
    templatePath: "",
    outputPath: "",
    dataSource: "dataPath",
    dataPath: "",
    dataJson: "",
    overwrite: false,
    variables: [],
  },
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
  cardSummary: documentTemplateNodeCardSummary,
  configFields: [
    { name: "templatePath", kind: "text", label: "模板文件" },
    { name: "outputPath", kind: "text", label: "输出文件" },
    { name: "dataSource", kind: "select", label: "数据来源" },
    { name: "dataPath", kind: "text", label: "JSON 文件", optional: true },
    { name: "dataJson", kind: "text", label: "内联 JSON", optional: true },
    { name: "overwrite", kind: "record", label: "覆盖", optional: true },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
  ],
  configSchema: documentTemplateNodeConfigSchema,
}
