import { CodeXml, FileCode2 } from "lucide-react"
import type { NodeManifest } from "../../../workflow-nodes/types"
import {
  HTML_GENERATOR_EJS_CAPABILITY_ID,
  HTML_GENERATOR_EJS_FILE_CAPABILITY_ID,
  HTML_GENERATOR_EJS_FILE_WORKFLOW_NODE_TYPE,
  HTML_GENERATOR_EJS_WORKFLOW_NODE_TYPE,
} from "../shared/capability"
import {
  htmlGeneratorEjsFileNodeConfigSchema,
  htmlGeneratorEjsNodeConfigSchema,
  type HtmlGeneratorEjsFileNodeConfig,
  type HtmlGeneratorEjsNodeConfig,
} from "./schema"

export const htmlGeneratorEjsNodeManifest: NodeManifest<HtmlGeneratorEjsNodeConfig> = {
  type: HTML_GENERATOR_EJS_WORKFLOW_NODE_TYPE,
  title: "生成 HTML",
  icon: CodeXml,
  color: "bg-primary/10",
  defaultConfig: { template: "", variables: [] },
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "HTML" }] },
  cardSummary: (config) => ({
    title: "生成 HTML",
    subtitle: dataSourceSummary(config.variables),
  }),
  configFields: [
    { name: "template", kind: "text", label: "EJS 模板" },
    { name: "variables", kind: "variable-binding-list", label: "数据来源" },
  ],
  configSchema: htmlGeneratorEjsNodeConfigSchema,
  share: {
    selfContained: false,
    capability: { id: HTML_GENERATOR_EJS_CAPABILITY_ID, minVersion: "1.0.0", installSourceId: "synapse.builtin" },
    risks: [{ path: ["template"], id: "shell.execute", when: "present" }],
  },
}

export const htmlGeneratorEjsFileNodeManifest: NodeManifest<HtmlGeneratorEjsFileNodeConfig> = {
  type: HTML_GENERATOR_EJS_FILE_WORKFLOW_NODE_TYPE,
  title: "生成 HTML 文件",
  icon: FileCode2,
  color: "bg-primary/10",
  defaultConfig: { template: "", outputPath: "", overwrite: false, variables: [] },
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "路径" }] },
  cardSummary: (config) => ({
    title: "生成 HTML 文件",
    subtitle: config.outputPath || "未设置输出文件",
  }),
  configFields: [
    { name: "template", kind: "text", label: "EJS 模板" },
    { name: "outputPath", kind: "text", label: "输出文件" },
    { name: "overwrite", kind: "boolean", label: "覆盖已存在文件" },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
  ],
  configSchema: htmlGeneratorEjsFileNodeConfigSchema,
  share: {
    selfContained: false,
    capability: { id: HTML_GENERATOR_EJS_FILE_CAPABILITY_ID, minVersion: "1.0.0", installSourceId: "synapse.builtin" },
    resources: [{ path: ["outputPath"], entryType: "file", cardinality: "one", access: "write" }],
    risks: [{ path: ["template"], id: "shell.execute", when: "present" }],
  },
}

function dataSourceSummary(variables: HtmlGeneratorEjsNodeConfig["variables"]): string {
  const source = variables.find((binding) => binding.name === "data")?.source
  return source?.type === "node_output" && source.node ? `数据：${source.node}` : "未选择数据"
}
