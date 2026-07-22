import { FilePenLine } from "lucide-react"
import type { NodeManifest } from "../../../workflow-nodes/types"
import { TEXT_FILE_WRITER_CAPABILITY_ID, TEXT_FILE_WRITER_WORKFLOW_NODE_TYPE } from "../shared/capability"
import { DEFAULT_TEXT_FILE_ENCODING, DEFAULT_TEXT_FILE_OVERWRITE } from "../shared/schema"
import { textFileWriterNodeConfigSchema, type TextFileWriterNodeConfig } from "./schema"

export const textFileWriterNodeManifest: NodeManifest<TextFileWriterNodeConfig> = {
  type: TEXT_FILE_WRITER_WORKFLOW_NODE_TYPE,
  title: "文本写入文件",
  icon: FilePenLine,
  color: "bg-primary/10",
  defaultConfig: {
    path: "",
    text: "",
    encoding: DEFAULT_TEXT_FILE_ENCODING,
    overwrite: DEFAULT_TEXT_FILE_OVERWRITE,
    variables: [],
  },
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "路径" }] },
  cardSummary: (config) => ({
    title: "文本写入文件",
    subtitle: config.path || "未设置文件路径",
  }),
  configFields: [
    { name: "path", kind: "text", label: "文件路径" },
    { name: "text", kind: "text", label: "文本内容" },
    { name: "encoding", kind: "select", label: "字符编码" },
    { name: "overwrite", kind: "boolean", label: "覆盖" },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
  ],
  configSchema: textFileWriterNodeConfigSchema,
  share: {
    selfContained: false,
    capability: {
      id: TEXT_FILE_WRITER_CAPABILITY_ID,
      minVersion: "1.0.0",
      installSourceId: "synapse.builtin",
    },
    resources: [{ path: ["path"], entryType: "file", cardinality: "one", access: "write" }],
  },
}
