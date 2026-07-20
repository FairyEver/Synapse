import { FileText } from "lucide-react"
import type { NodeManifest } from "../../../workflow-nodes/types"
import { DOCUMENT_TEMPLATE_CAPABILITY_ID, DOCUMENT_TEMPLATE_WORKFLOW_NODE_TYPE } from "../shared/capability"
import { documentTemplateNodeConfigSchema, type DocumentTemplateNodeConfig } from "./schema"

export const documentTemplateNodeManifest: NodeManifest<DocumentTemplateNodeConfig> = {
  type: DOCUMENT_TEMPLATE_WORKFLOW_NODE_TYPE,
  title: "模板生成文档",
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
  cardSummary: (config) => ({
    title: "模板生成文档",
    subtitle: config.outputPath || "未设置输出文件",
  }),
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
  share: {
    selfContained: false,
    capability: {
      id: DOCUMENT_TEMPLATE_CAPABILITY_ID,
      minVersion: "1.0.0",
      installSourceId: "synapse.builtin",
    },
    resources: [
      { path: ["templatePath"], entryType: "file", cardinality: "one", access: "read" },
      { path: ["outputPath"], entryType: "file", cardinality: "one", access: "write" },
      { path: ["dataPath"], entryType: "file", cardinality: "one", access: "read", optional: true },
    ],
  },
}
